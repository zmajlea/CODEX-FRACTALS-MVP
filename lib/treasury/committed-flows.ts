/**
 * Spec 65 — salvaged recurrence detection for upcoming committed flows.
 */

import { shiftPeriods, subtractDays } from "@/lib/treasury/period-bounds";
import { detectCadence, merchantMatches, type MerchantMatchFields } from "@/lib/treasury/rule-helpers";
import type { TreasuryRuleRow } from "@/lib/treasury/types";

export type CommittedFlowTx = {
  posted_date: string | null;
  amount: number;
  direction: string | null;
  normalized_merchant: string | null;
  raw_name: string | null;
  merchant_name: string | null;
  label: string | null;
};

export type CommittedFlowLine = {
  merchant: string;
  direction: "in" | "out";
  amount: number;
  cadence: string;
  nextDate: string;
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

function isRuleCovered(normalized: string, rules: TreasuryRuleRow[]): boolean {
  const fields: MerchantMatchFields = { normalized_merchant: normalized };
  return rules.some((rule) => merchantMatches(fields, rule));
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

export function detectCommittedFlows(
  txs: CommittedFlowTx[],
  rules: TreasuryRuleRow[],
  opts: {
    asOf: string;
    horizonDays?: number;
    lookbackDays?: number;
  }
): CommittedFlowLine[] {
  const asOf = opts.asOf.slice(0, 10);
  const horizonDays = opts.horizonDays ?? 30;
  const lookbackDays = opts.lookbackDays ?? 180;
  const lookbackStart = subtractDays(asOf, lookbackDays);
  const horizonEnd = shiftPeriods("day", asOf, horizonDays);

  type MerchantGroup = {
    merchant: string;
    direction: "in" | "out";
    dates: string[];
    amounts: number[];
    hasLabel: boolean;
    ruleCovered: boolean;
    matchingRule?: TreasuryRuleRow;
  };

  const groups = new Map<string, MerchantGroup>();

  for (const tx of txs) {
    if (!tx.posted_date || tx.posted_date < lookbackStart || tx.posted_date > asOf) {
      continue;
    }
    const normalized =
      tx.normalized_merchant ??
      (tx.merchant_name ?? tx.raw_name ?? "").trim().toUpperCase();
    if (!normalized) continue;
    if (tx.direction !== "in" && tx.direction !== "out") continue;
    const direction = tx.direction;
    const key = groupKey(normalized, direction);
    const g = groups.get(key) ?? {
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
    g.dates.push(tx.posted_date);
    g.amounts.push(Math.abs(Number(tx.amount)));
    if (tx.label) g.hasLabel = true;
    groups.set(key, g);
  }

  const lines: CommittedFlowLine[] = [];

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

    for (const date of futureDates) {
      if (date <= asOf) continue;
      lines.push({
        merchant: g.merchant,
        direction: g.direction,
        amount,
        cadence: cadence.label,
        nextDate: date,
      });
    }
  }

  lines.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  return lines;
}
