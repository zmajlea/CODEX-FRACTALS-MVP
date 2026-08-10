/**
 * Spec 65 Part K — predicted vs actual breach backtest.
 */

import { computeCashModel, type CashModelTimelineRow } from "@/lib/treasury/cash-model";
import type { CashModelParams, CashModelScenario, CashModelBucketKey } from "@/lib/treasury/cash-model-types";
import type { MonthlyByCategorySeries } from "@/lib/treasury/load-monthly-by-category";
import { startOfMonth } from "@/lib/treasury/period-bounds";

export type CashModelBacktestRow = {
  asOfMonth: string;
  openingAtAsOf: number;
  predictedBreachMonth: string | null;
  predictedRunwayMonths: number | null;
  actualBreachMonth: string | null;
  actualLowMonth: string;
  actualLowEnding: number;
  match: boolean;
};

function truncateCategorySeries(
  series: MonthlyByCategorySeries,
  maxMonth: string
): MonthlyByCategorySeries {
  const max = maxMonth.slice(0, 10);
  const out: MonthlyByCategorySeries = {};
  for (const [label, months] of Object.entries(series)) {
    const bucket: Record<string, { in: number; out: number }> = {};
    for (const [m, cell] of Object.entries(months)) {
      if (m.slice(0, 10) <= max) bucket[m] = cell;
    }
    if (Object.keys(bucket).length > 0) out[label] = bucket;
  }
  return out;
}

function firstActualBreachAfter(
  timeline: CashModelTimelineRow[],
  afterMonth: string,
  threshold: number
): string | null {
  for (const row of timeline) {
    if (row.kind !== "actual") continue;
    if (row.month <= afterMonth) continue;
    if (row.ending < threshold) return row.month;
  }
  return null;
}

function endingAtMonth(timeline: CashModelTimelineRow[], month: string): number | null {
  const row = timeline.find((r) => r.month === month && r.kind === "actual");
  return row != null ? row.ending : null;
}

export function backtestCashModel(
  categorySeries: MonthlyByCategorySeries,
  bucketMap: Record<string, CashModelBucketKey>,
  openingBalance: number,
  asOf: string,
  params: CashModelParams,
  scenarios: CashModelScenario[],
  opts?: { months?: number; fullTimeline?: CashModelTimelineRow[] }
): CashModelBacktestRow[] {
  const selectedScenarioId = params.selectedScenarioId;
  const selected = scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0];
  if (!selected) return [];

  const excludedMonthSet = new Set(
    (params.excludedMonths ?? []).map((e) => e.month.slice(0, 7))
  );

  const full = computeCashModel({
    categorySeries,
    bucketMap,
    openingBalance,
    asOf,
    params,
    scenarios,
    excludedMonthSet,
  });
  if (full.refused || full.completeMonths.length < 4) return [];

  const fullTimeline = opts?.fullTimeline ?? full.timeline;
  const window = opts?.months ?? Math.min(12, Math.max(3, full.completeMonths.length - 1));
  const asOfMonth = startOfMonth(asOf.slice(0, 10));
  const candidates = full.completeMonths
    .filter((m) => m < asOfMonth)
    .slice(-window);

  const rows: CashModelBacktestRow[] = [];

  for (const month of candidates) {
    const openingAtAsOf = endingAtMonth(fullTimeline, month);
    if (openingAtAsOf == null) continue;

    const truncated = truncateCategorySeries(categorySeries, month);
    const retro = computeCashModel({
      categorySeries: truncated,
      bucketMap,
      openingBalance: openingAtAsOf,
      asOf: month,
      params,
      scenarios,
      excludedMonthSet,
    });
    if (retro.refused) continue;

    const pred = retro.summaries.find((s) => s.scenarioId === selectedScenarioId);
    const actualBreach = firstActualBreachAfter(
      fullTimeline,
      month,
      selected.minCashThreshold
    );

    let actualLowMonth = month;
    let actualLowEnding = openingAtAsOf;
    for (const row of fullTimeline) {
      if (row.kind !== "actual" || row.month <= month) continue;
      if (row.ending < actualLowEnding) {
        actualLowEnding = row.ending;
        actualLowMonth = row.month;
      }
    }

    const predictedBreach = pred?.breachMonth ?? null;
    const match =
      (predictedBreach == null && actualBreach == null) ||
      (predictedBreach != null &&
        actualBreach != null &&
        predictedBreach.slice(0, 7) === actualBreach.slice(0, 7));

    rows.push({
      asOfMonth: month,
      openingAtAsOf,
      predictedBreachMonth: predictedBreach,
      predictedRunwayMonths: pred?.runwayMonths ?? null,
      actualBreachMonth: actualBreach,
      actualLowMonth,
      actualLowEnding,
      match,
    });
  }

  return rows;
}
