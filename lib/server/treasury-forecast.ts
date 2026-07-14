import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMerchant } from "@/lib/treasury/normalize";
import {
  lastNPeriodStarts,
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

const LOOKBACK_DAYS = 180;
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

function isRuleCovered(
  normalized: string,
  rules: TreasuryRuleRow[]
): boolean {
  return rules.some((rule) => merchantMatches(normalized, rule));
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

export async function computeTreasuryForecast(
  admin: AdminClient,
  clientUserId: string,
  granularity: SummaryGranularity
): Promise<TreasuryForecastResponse> {
  const today = todayIso();
  const lookbackFrom = subtractDays(today, LOOKBACK_DAYS);
  const horizon = HORIZON[granularity];
  const baselineK = BASELINE_PERIODS[granularity];
  const anchor = periodStartOf(granularity, today);
  const horizonEnd = shiftPeriods(granularity, anchor, horizon);

  const { data: accounts } = await admin
    .from("treasury_accounts")
    .select("current_balance, iso_currency_code")
    .eq("client_user_id", clientUserId);

  const { data: allTxs } = await admin
    .from("treasury_transactions")
    .select(
      "posted_date, amount, direction, iso_currency_code, normalized_merchant, raw_name, merchant_name, label"
    )
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .eq("pending", false)
    .gte("posted_date", lookbackFrom)
    .lte("posted_date", today);

  const { count: pendingCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .eq("pending", true);

  const { data: rulesData } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("active", true);

  const rules = (rulesData ?? []) as TreasuryRuleRow[];
  const txs = (allTxs ?? []) as TxRow[];

  const currencyCounts = new Map<string, number>();
  for (const tx of txs) {
    const cur = tx.iso_currency_code ?? "USD";
    currencyCounts.set(cur, (currencyCounts.get(cur) ?? 0) + 1);
  }
  let currency = "USD";
  let maxCount = 0;
  for (const [cur, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count;
      currency = cur;
    }
  }

  const otherCurrencies = [
    ...new Set(
      (accounts ?? [])
        .map((a) => a.iso_currency_code ?? "USD")
        .filter((c) => c !== currency)
    ),
  ];

  const seed_balance = (accounts ?? [])
    .filter((a) => (a.iso_currency_code ?? "USD") === currency)
    .reduce((sum, a) => sum + Number(a.current_balance ?? 0), 0);

  const as_of = await getLastTransactionsSyncedAt(admin, clientUserId);

  const primaryTxs = txs.filter((t) => (t.iso_currency_code ?? "USD") === currency && t.posted_date);

  const historyPeriods = new Set(
    primaryTxs.map((t) => periodStartOf(granularity, t.posted_date!))
  );

  let firstDate: string | null = null;
  for (const t of primaryTxs) {
    if (t.posted_date && (!firstDate || t.posted_date < firstDate)) {
      firstDate = t.posted_date;
    }
  }
  const history_days = firstDate
    ? Math.max(
        0,
        Math.round(
          (new Date(today + "T12:00:00Z").getTime() -
            new Date(firstDate + "T12:00:00Z").getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0;

  const unlabeled = primaryTxs.filter((t) => !t.label).length;
  const unlabeled_share_pct =
    primaryTxs.length > 0 ? Math.round((unlabeled / primaryTxs.length) * 100) : 100;

  if (primaryTxs.length === 0 || historyPeriods.size < 2) {
    return {
      granularity,
      horizon,
      currency,
      seed_balance,
      as_of,
      baseline_periods: baselineK,
      periods: [],
      excluded: {
        other_currencies: otherCurrencies,
        pending_count: pendingCount ?? 0,
        unlabeled_share_pct,
      },
      insufficient_history: true,
      history_days,
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
    const direction = (tx.direction === "in" ? "in" : "out") as "in" | "out";
    const key = groupKey(normalized, direction);
    const g = groups.get(key) ?? {
      key,
      merchant: normalized,
      direction,
      dates: [],
      amounts: [],
      hasLabel: false,
      ruleCovered: isRuleCovered(normalized, rules),
      matchingRule: rules.find((r) => merchantMatches(normalized, r)),
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

  const { starts: baselineStarts } = lastNPeriodStarts(granularity, baselineK);
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
      const direction = tx.direction === "in" ? "in" : "out";
      if (normalized && recurringGroupKeys.has(groupKey(normalized, direction))) {
        continue;
      }
      const amt = Math.abs(Number(tx.amount));
      if (tx.direction === "in") inflow += amt;
      else outflow += amt;
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
      other_currencies: otherCurrencies,
      pending_count: pendingCount ?? 0,
      unlabeled_share_pct,
    },
    history_days,
  };
}
