/**
 * Spec 65 — pure Cash Model math (no server imports).
 */

import { addMonths, startOfMonth } from "@/lib/treasury/period-bounds";
import { computeL0, deriveCompleteMonths } from "@/lib/treasury/spend-plan";
import {
  CASH_MODEL_BUCKET_KEYS,
  type CashModelBucketKey,
  type CashModelParams,
  type CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import type { MonthlyByCategorySeries } from "@/lib/treasury/load-monthly-by-category";

const INFLOW_BUCKETS: CashModelBucketKey[] = ["collections", "other_income", "uncategorized_in"];
const OUTFLOW_BUCKETS: CashModelBucketKey[] = [
  "payroll",
  "opex",
  "debt_service",
  "capex",
  "other_out",
  "uncategorized_out",
];

const MIN_COMPLETE_MONTHS = 3;
const COVERAGE_DEGRADE_THRESHOLD = 0.35;

export type CashModelTimelineRow = {
  month: string;
  kind: "actual" | "projected";
  byBucket: Partial<Record<CashModelBucketKey, number>>;
  ncf: number;
  ending: number;
  breachFlag: boolean;
  /** Backward-walk actual ending — approximate; always disclosed in UI. */
  historyDerived?: boolean;
};

export type CashModelScenarioSummary = {
  scenarioId: string;
  scenarioName: string;
  runwayMonths: number | null;
  breachMonth: string | null;
  minEnding: { month: string; value: number };
  thresholdMarginAtLow: number;
  noBreachInHorizon: boolean;
};

export type CashModelComputeInput = {
  categorySeries: MonthlyByCategorySeries;
  bucketMap: Record<string, CashModelBucketKey>;
  openingBalance: number;
  asOf: string;
  params: CashModelParams;
  scenarios: CashModelScenario[];
  excludedMonthSet: Set<string>;
};

export type CashModelResult = {
  timeline: CashModelTimelineRow[];
  summaries: CashModelScenarioSummary[];
  coveragePct: number;
  degradedToTotals: boolean;
  refused: boolean;
  refuseReason?: string;
  bucketBaselines: Partial<Record<CashModelBucketKey, number>>;
  completeMonths: string[];
};

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** Name-match defaults when operator bucketMap has no entry. */
export function defaultBucketForLabel(
  label: string,
  direction: "in" | "out"
): CashModelBucketKey {
  if (label === "__uncategorized__") {
    return direction === "in" ? "uncategorized_in" : "uncategorized_out";
  }
  const n = normalizeLabel(label);
  if (direction === "in") {
    if (n.includes("collection") || n.includes("revenue") || n.includes("receipt")) {
      return "collections";
    }
    return "other_income";
  }
  if (n.includes("payroll") || n.includes("salary") || n.includes("wage")) return "payroll";
  if (n.includes("debt") || n.includes("loan") || n.includes("interest")) return "debt_service";
  if (n.includes("capex") || n.includes("capital")) return "capex";
  if (n.includes("opex") || n.includes("operating")) return "opex";
  return "other_out";
}

function emptyBucketMonths(): Record<CashModelBucketKey, Record<string, number>> {
  const out = {} as Record<CashModelBucketKey, Record<string, number>>;
  for (const k of CASH_MODEL_BUCKET_KEYS) out[k] = {};
  return out;
}

/** Aggregate label series into Tim buckets (both directions). */
export function buildBucketSeries(
  categorySeries: MonthlyByCategorySeries,
  bucketMap: Record<string, CashModelBucketKey>
): Record<CashModelBucketKey, Record<string, number>> {
  const buckets = emptyBucketMonths();
  for (const [label, months] of Object.entries(categorySeries)) {
    for (const [month, amounts] of Object.entries(months)) {
      if (amounts.in > 0) {
        const b = bucketMap[label] ?? defaultBucketForLabel(label, "in");
        buckets[b][month] = (buckets[b][month] ?? 0) + amounts.in;
      }
      if (amounts.out > 0) {
        const b = bucketMap[label] ?? defaultBucketForLabel(label, "out");
        buckets[b][month] = (buckets[b][month] ?? 0) + amounts.out;
      }
    }
  }
  return buckets;
}

function allMonthsFromBuckets(
  buckets: Record<CashModelBucketKey, Record<string, number>>
): string[] {
  const set = new Set<string>();
  for (const b of CASH_MODEL_BUCKET_KEYS) {
    for (const m of Object.keys(buckets[b])) set.add(m);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function ncfForMonth(
  byBucket: Partial<Record<CashModelBucketKey, number>>
): number {
  let inflow = 0;
  let outflow = 0;
  for (const b of INFLOW_BUCKETS) inflow += byBucket[b] ?? 0;
  for (const b of OUTFLOW_BUCKETS) outflow += byBucket[b] ?? 0;
  return inflow - outflow;
}

function computeCoverage(
  categorySeries: MonthlyByCategorySeries,
  completeMonths: string[]
): number {
  if (completeMonths.length === 0) return 0;
  const window = completeMonths.slice(-6);
  let labeled = 0;
  let total = 0;
  for (const [, months] of Object.entries(categorySeries)) {
    for (const m of window) {
      const cell = months[m];
      if (!cell) continue;
      const sum = cell.in + cell.out;
      total += sum;
    }
  }
  for (const [label, months] of Object.entries(categorySeries)) {
    if (label === "__uncategorized__") continue;
    for (const m of window) {
      const cell = months[m];
      if (!cell) continue;
      labeled += cell.in + cell.out;
    }
  }
  if (total <= 0) return 0;
  return labeled / total;
}

function bucketBaseline(
  bucket: CashModelBucketKey,
  bucketSeries: Record<CashModelBucketKey, Record<string, number>>,
  completeMonths: string[],
  excluded: Set<string>
): number {
  const amounts: Record<string, number> = {};
  for (const m of completeMonths) {
    if (excluded.has(m.slice(0, 7))) continue;
    amounts[m] = bucketSeries[bucket][m] ?? 0;
  }
  const months = deriveCompleteMonths(amounts, completeMonths.at(-1) ?? "2020-01-01");
  const window = months.slice(-6);
  return computeL0(amounts, window) ?? 0;
}

function monthKeysThroughHorizon(asOfMonth: string, historyMonths: string[], horizon: number): {
  history: string[];
  projected: string[];
} {
  const asOf = startOfMonth(asOfMonth.slice(0, 10));
  const history = [...historyMonths].sort((a, b) => a.localeCompare(b));
  const projected: string[] = [];
  let cursor = asOf;
  for (let i = 0; i < horizon; i++) {
    cursor = addMonths(cursor, 1);
    projected.push(cursor);
  }
  return { history: history.filter((m) => m <= asOf), projected };
}

function summarizeScenario(
  scenario: CashModelScenario,
  timeline: CashModelTimelineRow[],
  asOfMonth: string
): CashModelScenarioSummary {
  const projected = timeline.filter((r) => r.kind === "projected");
  let breachMonth: string | null = null;
  let runwayMonths: number | null = null;
  let minEnding = { month: asOfMonth, value: Infinity };
  for (const row of projected) {
    if (row.ending < minEnding.value) {
      minEnding = { month: row.month, value: row.ending };
    }
    if (!breachMonth && row.breachFlag) {
      breachMonth = row.month;
      const asOf = startOfMonth(asOfMonth.slice(0, 10));
      const m = startOfMonth(row.month.slice(0, 10));
      let months = 0;
      let c = asOf;
      while (c < m && months < 240) {
        c = addMonths(c, 1);
        months += 1;
      }
      runwayMonths = months;
    }
  }
  if (minEnding.value === Infinity) minEnding = { month: asOfMonth, value: 0 };
  const thresholdMarginAtLow = minEnding.value - scenario.minCashThreshold;
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    runwayMonths,
    breachMonth,
    minEnding,
    thresholdMarginAtLow,
    noBreachInHorizon: breachMonth == null,
  };
}

function buildTimelineForScenario(
  input: CashModelComputeInput,
  scenario: CashModelScenario,
  baselines: Partial<Record<CashModelBucketKey, number>>,
  bucketSeries: Record<CashModelBucketKey, Record<string, number>>,
  completeMonths: string[],
  degradedToTotals: boolean
): CashModelTimelineRow[] {
  const asOfMonth = startOfMonth(input.asOf.slice(0, 10));
  const { history, projected } = monthKeysThroughHorizon(
    asOfMonth,
    completeMonths,
    input.params.horizon
  );
  const timeline: CashModelTimelineRow[] = [];
  const historyNcfs: Record<string, number> = {};

  for (const month of history) {
    const byBucket: Partial<Record<CashModelBucketKey, number>> = {};
    for (const b of CASH_MODEL_BUCKET_KEYS) byBucket[b] = bucketSeries[b][month] ?? 0;
    applyDegradeTotals(byBucket, degradedToTotals);
    historyNcfs[month] = ncfForMonth(byBucket);
  }

  const endingByMonth: Record<string, number> = { [asOfMonth]: input.openingBalance };
  for (const month of [...history].reverse()) {
    if (month === asOfMonth) continue;
    const nextMonth = addMonths(month, 1);
    const nextEnding = endingByMonth[nextMonth] ?? input.openingBalance;
    endingByMonth[month] = nextEnding - (historyNcfs[month] ?? 0);
  }

  for (const month of history) {
    const byBucket: Partial<Record<CashModelBucketKey, number>> = {};
    for (const b of CASH_MODEL_BUCKET_KEYS) byBucket[b] = bucketSeries[b][month] ?? 0;
    applyDegradeTotals(byBucket, degradedToTotals);
    timeline.push({
      month,
      kind: "actual",
      byBucket,
      ncf: historyNcfs[month] ?? 0,
      ending: endingByMonth[month] ?? input.openingBalance,
      breachFlag: (endingByMonth[month] ?? 0) < scenario.minCashThreshold,
      historyDerived: true,
    });
  }

  let ending = input.openingBalance;
  for (const month of projected) {
    const byBucket: Partial<Record<CashModelBucketKey, number>> = {};
    for (const b of CASH_MODEL_BUCKET_KEYS) {
      byBucket[b] = (baselines[b] ?? 0) * (scenario.factors[b] ?? 1);
    }
    applyDegradeTotals(byBucket, degradedToTotals);
    const ncf = ncfForMonth(byBucket);
    ending += ncf;
    timeline.push({
      month,
      kind: "projected",
      byBucket,
      ncf,
      ending,
      breachFlag: ending < scenario.minCashThreshold,
    });
  }
  return timeline;
}

function applyDegradeTotals(
  byBucket: Partial<Record<CashModelBucketKey, number>>,
  degraded: boolean
) {
  if (!degraded) return;
  const inT =
    (byBucket.collections ?? 0) +
    (byBucket.other_income ?? 0) +
    (byBucket.uncategorized_in ?? 0);
  const outT =
    (byBucket.payroll ?? 0) +
    (byBucket.opex ?? 0) +
    (byBucket.debt_service ?? 0) +
    (byBucket.capex ?? 0) +
    (byBucket.other_out ?? 0) +
    (byBucket.uncategorized_out ?? 0);
  for (const b of CASH_MODEL_BUCKET_KEYS) byBucket[b] = 0;
  byBucket.uncategorized_in = inT;
  byBucket.uncategorized_out = outT;
}

export function computeCashModel(input: CashModelComputeInput): CashModelResult {
  const bucketSeries = buildBucketSeries(input.categorySeries, input.bucketMap);
  const allMonths = allMonthsFromBuckets(bucketSeries);
  const completeMonths = deriveCompleteMonths(
    Object.fromEntries(allMonths.map((m) => [m, 1])),
    input.asOf.slice(0, 10)
  );

  if (completeMonths.length < MIN_COMPLETE_MONTHS) {
    return {
      timeline: [],
      summaries: [],
      coveragePct: 0,
      degradedToTotals: false,
      refused: true,
      refuseReason: `insufficient_history (${completeMonths.length} complete months)`,
      bucketBaselines: {},
      completeMonths,
    };
  }

  const coveragePct = computeCoverage(input.categorySeries, completeMonths);
  const degradedToTotals = coveragePct < COVERAGE_DEGRADE_THRESHOLD;

  const baselines: Partial<Record<CashModelBucketKey, number>> = {};
  for (const b of CASH_MODEL_BUCKET_KEYS) {
    baselines[b] = bucketBaseline(b, bucketSeries, completeMonths, input.excludedMonthSet);
  }

  const selected =
    input.scenarios.find((s) => s.id === input.params.selectedScenarioId) ??
    input.scenarios[0];
  if (!selected) {
    return {
      timeline: [],
      summaries: [],
      coveragePct,
      degradedToTotals,
      refused: true,
      refuseReason: "no_scenario",
      bucketBaselines: baselines,
      completeMonths,
    };
  }

  const timeline = buildTimelineForScenario(
    input,
    selected,
    baselines,
    bucketSeries,
    completeMonths,
    degradedToTotals
  );

  const summaries = input.scenarios.map((s) => {
    const tl =
      s.id === selected.id
        ? timeline
        : buildTimelineForScenario(
            input,
            s,
            baselines,
            bucketSeries,
            completeMonths,
            degradedToTotals
          );
    return summarizeScenario(s, tl, startOfMonth(input.asOf.slice(0, 10)));
  });

  return {
    timeline,
    summaries,
    coveragePct,
    degradedToTotals,
    refused: false,
    bucketBaselines: baselines,
    completeMonths,
  };
}

/** Reconstruct ending at asOf from backward walk — gate oracle helper. */
export function endingAtAsOfFromHistory(
  openingBalance: number,
  categorySeries: MonthlyByCategorySeries,
  bucketMap: Record<string, CashModelBucketKey>,
  asOf: string,
  excludedMonthSet: Set<string>
): number {
  const bucketSeries = buildBucketSeries(categorySeries, bucketMap);
  const allMonths = allMonthsFromBuckets(bucketSeries);
  const completeMonths = deriveCompleteMonths(
    Object.fromEntries(allMonths.map((m) => [m, 1])),
    asOf.slice(0, 10)
  );
  const asOfMonth = startOfMonth(asOf.slice(0, 10));
  const history = completeMonths.filter((m) => m <= asOfMonth);
  const ncfs: Record<string, number> = {};
  for (const month of history) {
    const byBucket: Partial<Record<CashModelBucketKey, number>> = {};
    for (const b of CASH_MODEL_BUCKET_KEYS) byBucket[b] = bucketSeries[b][month] ?? 0;
    ncfs[month] = ncfForMonth(byBucket);
  }
  let ending = openingBalance;
  for (const month of [...history].reverse()) {
    if (month === asOfMonth) break;
    ending -= ncfs[month] ?? 0;
  }
  return ending;
}
