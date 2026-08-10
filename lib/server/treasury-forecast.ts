/**
 * Spec 65 Part I — operator Forecast surface retired.
 * Recurrence detection salvaged into `lib/treasury/committed-flows.ts`
 * (shared `detectCadence` from rule-helpers). This module remains for
 * historical gate scripts only; the operator `/forecast` route is gone.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { normalizeMerchant } from "@/lib/treasury/normalize";
import {
  periodEnd,
  periodStartOf,
  shiftPeriods,
  subtractDays,
  todayIso,
} from "@/lib/treasury/period-bounds";
import type {
  SummaryGranularity,
  TreasuryForecastPeriod,
  TreasuryForecastRecurringLine,
  TreasuryForecastResponse,
  TreasuryRuleRow,
} from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";
import { detectCadence, merchantMatches } from "@/lib/server/treasury-rule-helpers";
import { getLastTransactionsSyncedAt } from "@/lib/server/treasury-sync";

type AdminClient = SupabaseClient<Database>;

/** Recent window for detecting recurrence patterns — independent of baseline length. */
const RECURRING_LOOKBACK_DAYS = 180;

const HORIZON: Record<SummaryGranularity, number> = { day: 15, week: 13, month: 4 };
const BASELINE_PERIODS: Record<SummaryGranularity, number> = {
  day: 30,
  week: 12,
  month: 6,
};

type TxRow = {
  posted_date: string | null;
  amount: number;
  direction: string | null;
  iso_currency_code: string | null;
  normalized_merchant: string | null;
  raw_name: string | null;
  merchant_name: string | null;
  label: string | null;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function groupKey(normalized: string, direction: string | null): string {
  return `${normalized}|${direction ?? "out"}`;
}

/**
 * Spec 52 guardrail: forecast still matches on the single normalized string only.
 * Wrap as { normalized_merchant } so merchantMatches compiles without widening
 * recurrence to raw_name / description (rules-engine decision, not this path).
 */
function isRuleCovered(
  normalized: string,
  rules: TreasuryRuleRow[]
): boolean {
  return rules.some((rule) =>
    merchantMatches({ normalized_merchant: normalized }, rule)
  );
}

function gapDaysForRule(rule: TreasuryRuleRow | undefined, detected: number): number {
  if (!rule?.cadence) return detected;
  const c = rule.cadence.toLowerCase();
  if (c.includes("week") && c.includes("bi")) return 14;
  if (c.includes("week")) return 7;
  if (c.includes("month")) return 30;
  if (c.includes("quarter")) return 91;
  return detected;
}

function projectFutureDates(
  lastDate: string,
  gapDays: number,
  horizonEnd: string
): string[] {
  const dates: string[] = [];
  let cur = lastDate;
  const step = Math.max(1, Math.round(gapDays));
  while (true) {
    cur = shiftPeriods("day", cur, step);
    if (cur > horizonEnd) break;
    dates.push(cur);
  }
  return dates;
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Posted_date span for one account — a fact about that account's book. */
async function fetchBookDataSpan(
  admin: AdminClient,
  clientUserId: string,
  accountId: string
): Promise<{ first: string; last: string } | null> {
  const { data: firstRow } = await admin
    .from("treasury_transactions")
    .select("posted_date")
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .eq("is_removed", false)
    .eq("pending", false)
    .not("posted_date", "is", null)
    .order("posted_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: lastRow } = await admin
    .from("treasury_transactions")
    .select("posted_date")
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .eq("is_removed", false)
    .eq("pending", false)
    .not("posted_date", "is", null)
    .order("posted_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const first = firstRow?.posted_date ?? null;
  const last = lastRow?.posted_date ?? null;
  if (!first || !last) return null;
  return { first, last };
}

export async function computeTreasuryForecast(
  admin: AdminClient,
  clientUserId: string,
  granularity: SummaryGranularity,
  accountId: string
): Promise<TreasuryForecastResponse> {
  const today = todayIso();
  const horizon = HORIZON[granularity];
  const baselineK = BASELINE_PERIODS[granularity];

  const data_span = await fetchBookDataSpan(admin, clientUserId, accountId);
  const anchorDate = data_span?.last ?? today;

  const anchor = periodStartOf(granularity, anchorDate);
  const horizonEnd = shiftPeriods(granularity, anchor, horizon);

  // Baseline window: trailing N *complete* periods (exclude unfinished current).
  const currentPeriod = periodStartOf(granularity, anchorDate);
  const lastCompleteStart = shiftPeriods(granularity, currentPeriod, -1);
  const baselineStarts: string[] = [];
  for (let i = baselineK - 1; i >= 0; i--) {
    baselineStarts.push(shiftPeriods(granularity, lastCompleteStart, -i));
  }
  const earliestBaselineStart = baselineStarts[0]!;

  // Two different questions — name them separately so they cannot drift apart again.
  const recurringLookbackStart = subtractDays(today, RECURRING_LOOKBACK_DAYS);
  const lookbackStartUnclamped = minIso(recurringLookbackStart, earliestBaselineStart);

  // Query window covers both recurrence lookback and full baseline periods, clamped to the book.
  let lookbackFrom = lookbackStartUnclamped;
  if (data_span) {
    lookbackFrom = maxIso(lookbackFrom, data_span.first);
    if (lookbackFrom > data_span.last) {
      lookbackFrom = data_span.first;
    }
  }
  const lookbackTo = data_span ? minIso(today, data_span.last) : today;

  const { data: accountRow } = await admin
    .from("treasury_accounts")
    .select("current_balance, iso_currency_code, name, account_id")
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!accountRow) {
    throw new Error(`Account not found for client: ${accountId}`);
  }

  const allTxs = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select(
        "posted_date, amount, direction, iso_currency_code, normalized_merchant, raw_name, merchant_name, label"
      )
      .eq("client_user_id", clientUserId)
      .eq("account_id", accountId)
      .eq("is_removed", false)
      .eq("pending", false)
      .gte("posted_date", lookbackFrom)
      .lte("posted_date", lookbackTo)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const { count: pendingCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .eq("is_removed", false)
    .eq("pending", true);

  const { data: rulesData } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("active", true);

  const rules = (rulesData ?? []) as TreasuryRuleRow[];
  const txs = (allTxs ?? []) as TxRow[];

  const currency = accountRow.iso_currency_code ?? "USD";

  const seed_balance = Number(accountRow.current_balance ?? 0);

  const as_of = await getLastTransactionsSyncedAt(admin, clientUserId);

  const primaryTxs = txs.filter(
    (t) => (t.iso_currency_code ?? "USD") === currency && t.posted_date
  );

  const bookFirst = data_span?.first ?? null;
  const bookLast = data_span?.last ?? null;

  const historyPeriods = new Set(
    primaryTxs.map((t) => periodStartOf(granularity, t.posted_date!))
  );

  const history_days =
    bookFirst != null
      ? Math.max(
          0,
          Math.round(
            (new Date(today + "T12:00:00Z").getTime() -
              new Date(bookFirst + "T12:00:00Z").getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : 0;

  const unlabeled = primaryTxs.filter((t) => !t.label).length;
  const unlabeled_share_pct =
    primaryTxs.length > 0 ? Math.round((unlabeled / primaryTxs.length) * 100) : 100;

  const excludedBase = {
    other_currencies: [] as string[],
    pending_count: pendingCount ?? 0,
    unlabeled_share_pct,
  };

  const accountMeta = {
    account_id: accountId,
    account_name: accountRow.name ?? accountId,
  };

  if (primaryTxs.length === 0 || historyPeriods.size < 2) {
    return {
      granularity,
      horizon,
      currency,
      seed_balance,
      as_of,
      baseline_periods: baselineK,
      periods: [],
      excluded: excludedBase,
      insufficient_history: true,
      history_days,
      data_span,
      ...accountMeta,
    };
  }

  // Seed window vs the book — never vs a lookback slice.
  const seedFullyInside =
    bookFirst != null &&
    bookLast != null &&
    baselineStarts.every((start) => {
      const end = periodEnd(granularity, start);
      return start >= bookFirst && end <= bookLast;
    });

  if (!seedFullyInside) {
    return {
      granularity,
      horizon,
      currency,
      seed_balance,
      as_of,
      baseline_periods: baselineK,
      periods: [],
      excluded: excludedBase,
      refuse_projection: true,
      refuse_reason: bookLast
        ? `Cannot project — seed window is outside the data span (data through ${bookLast}).`
        : "Cannot project — no data span.",
      history_days,
      data_span,
      ...accountMeta,
    };
  }

  type MerchantGroup = {
    key: string;
    merchant: string;
    direction: "in" | "out";
    dates: string[];
    amounts: number[];
    hasLabel: boolean;
    ruleCovered: boolean;
    matchingRule?: TreasuryRuleRow;
  };

  const groups = new Map<string, MerchantGroup>();

  for (const tx of primaryTxs) {
    const normalized =
      tx.normalized_merchant ?? normalizeMerchant(tx.raw_name, tx.merchant_name);
    if (!normalized) continue;
    if (tx.direction !== "in" && tx.direction !== "out") continue;
    const direction = tx.direction;
    const key = groupKey(normalized, direction);
    const g = groups.get(key) ?? {
      key,
      merchant: normalized,
      direction,
      dates: [],
      amounts: [],
      hasLabel: false,
      ruleCovered: isRuleCovered(normalized, rules),
      matchingRule: rules.find((r) =>
        merchantMatches({ normalized_merchant: normalized }, r)
      ),
    };
    if (tx.posted_date) g.dates.push(tx.posted_date);
    g.amounts.push(Math.abs(Number(tx.amount)));
    if (tx.label) g.hasLabel = true;
    groups.set(key, g);
  }

  const recurringGroupKeys = new Set<string>();
  const recurringByPeriod = new Map<string, TreasuryForecastRecurringLine[]>();

  for (const g of groups.values()) {
    if (g.dates.length < 3) continue;
    if (!g.hasLabel && !g.ruleCovered) continue;

    const cadence = detectCadence(g.dates);
    if (cadence.kind === "irregular") continue;

    const gapDays = gapDaysForRule(g.matchingRule, cadence.medianGapDays);
    const amount = median(g.amounts);
    const sortedDates = [...g.dates].sort();
    const lastDate = sortedDates[sortedDates.length - 1]!;
    const futureDates = projectFutureDates(lastDate, gapDays, horizonEnd);

    recurringGroupKeys.add(g.key);

    for (const date of futureDates) {
      const period = periodStartOf(granularity, date);
      const line: TreasuryForecastRecurringLine = {
        merchant: g.merchant,
        direction: g.direction,
        amount,
        cadence: cadence.label,
      };
      const list = recurringByPeriod.get(period) ?? [];
      list.push(line);
      recurringByPeriod.set(period, list);
    }
  }

  const residualInflows: number[] = [];
  const residualOutflows: number[] = [];

  for (const periodStart of baselineStarts) {
    let inflow = 0;
    let outflow = 0;
    for (const tx of primaryTxs) {
      if (!tx.posted_date) continue;
      if (periodStartOf(granularity, tx.posted_date) !== periodStart) continue;
      const normalized =
        tx.normalized_merchant ?? normalizeMerchant(tx.raw_name, tx.merchant_name);
      if (tx.direction !== "in" && tx.direction !== "out") continue;
      const direction = tx.direction;
      if (normalized && recurringGroupKeys.has(groupKey(normalized, direction))) {
        continue;
      }
      const amt = Math.abs(Number(tx.amount));
      if (tx.direction === "in") inflow += amt;
      else if (tx.direction === "out") outflow += amt;
    }
    residualInflows.push(inflow);
    residualOutflows.push(outflow);
  }

  const baseline_inflow = median(residualInflows);
  const baseline_outflow = median(residualOutflows);

  const futureStarts: string[] = [];
  for (let i = 1; i <= horizon; i++) {
    futureStarts.push(shiftPeriods(granularity, anchor, i));
  }

  const periods: TreasuryForecastPeriod[] = [];
  let closing = seed_balance;

  for (const period_start of futureStarts) {
    const recurring = recurringByPeriod.get(period_start) ?? [];
    const recurringIn = recurring
      .filter((r) => r.direction === "in")
      .reduce((s, r) => s + r.amount, 0);
    const recurringOut = recurring
      .filter((r) => r.direction === "out")
      .reduce((s, r) => s + r.amount, 0);

    const projected_receipts = recurringIn + baseline_inflow;
    const projected_disbursements = recurringOut + baseline_outflow;
    const net = projected_receipts - projected_disbursements;
    closing = closing + net;

    periods.push({
      period_start,
      recurring,
      baseline_inflow,
      baseline_outflow,
      projected_receipts,
      projected_disbursements,
      net,
      closing,
    });
  }

  return {
    granularity,
    horizon,
    currency,
    seed_balance,
    as_of,
    baseline_periods: baselineK,
    periods,
    excluded: {
      other_currencies: [],
      pending_count: pendingCount ?? 0,
      unlabeled_share_pct,
    },
    history_days,
    data_span,
    ...accountMeta,
  };
}

/** Empty-book response — zero accounts / no accountId yet (Spec 49 empty gate clients). */
export function emptyTreasuryForecast(
  granularity: SummaryGranularity
): TreasuryForecastResponse {
  const horizon = HORIZON[granularity];
  const baselineK = BASELINE_PERIODS[granularity];
  return {
    granularity,
    horizon,
    currency: "USD",
    seed_balance: 0,
    as_of: null,
    baseline_periods: baselineK,
    periods: [],
    excluded: {
      other_currencies: [],
      pending_count: 0,
      unlabeled_share_pct: 100,
    },
    insufficient_history: true,
    history_days: 0,
    data_span: null,
  };
}
