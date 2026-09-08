/**
 * Shared projection core — one engine, three faces (run-rate / trend / yoy).
 * Pure; no server-only. Forecast/seasonality kinds call this; cash_model does not.
 */

import { addMonths } from "@/lib/treasury/period-bounds";
import {
  computeL0,
  computeTtmYoyGrowth,
  deriveCompleteMonths,
  lastNFromCompleteMonths,
  toExcludedSet,
} from "@/lib/treasury/spend-plan";

export type ProjectionMethod = "run_rate" | "linear_trend" | "yoy_growth";

export type ProjectedPoint = {
  month: string;
  value: number;
  projected: boolean;
};

function monthStart(isoOrYm: string): string {
  const s = isoOrYm.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return `${s.slice(0, 7)}-01`;
}

function calendarMonth(isoOrYm: string): number {
  return Number(monthStart(isoOrYm).slice(5, 7));
}

function ym(isoOrYm: string): string {
  return monthStart(isoOrYm).slice(0, 7);
}

/** Ordinary least squares slope/intercept over y at x = 0..n-1. */
export function olsSlopeIntercept(values: number[]): {
  slope: number;
  intercept: number;
} {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0]! };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i]!;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Project a subject series forward.
 * Incomplete / thin history → empty `projected` (caller grades refused).
 */
export function projectSeries(input: {
  series: Record<string, number>;
  asOf: string;
  method: ProjectionMethod;
  window: number;
  horizon: number;
  excludedMonths?: string[];
  seasonalIndex?: Record<number, number> | null;
  factor?: number;
}): {
  historical: ProjectedPoint[];
  projected: ProjectedPoint[];
  trendPerMonth: number;
} {
  const factor = input.factor ?? 1;
  const excluded = toExcludedSet(input.excludedMonths);
  const normalized: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.series)) {
    normalized[monthStart(k)] = v;
  }

  const completeAll = deriveCompleteMonths(normalized, input.asOf).filter(
    (m) => !excluded.has(ym(m))
  );

  const historical: ProjectedPoint[] = completeAll.map((m) => ({
    month: ym(m),
    value: normalized[m] ?? 0,
    projected: false,
  }));

  if (completeAll.length < 3) {
    return { historical, projected: [], trendPerMonth: 0 };
  }

  const window = Math.max(1, Math.min(12, Math.floor(input.window)));
  const horizon = Math.max(1, Math.min(24, Math.floor(input.horizon)));
  const windowKeys = lastNFromCompleteMonths(completeAll, window);
  const windowVals = windowKeys.map((k) => normalized[k] ?? 0);

  let trendPerMonth = 0;
  let baseLevel = 0;
  let useYoy = false;
  let yoyG = 0;

  if (input.method === "run_rate") {
    baseLevel = computeL0(normalized, windowKeys) ?? 0;
    trendPerMonth = 0;
  } else if (input.method === "linear_trend") {
    const { slope, intercept } = olsSlopeIntercept(windowVals);
    trendPerMonth = slope;
    // Next projected month is at x = windowKeys.length (one step past last sample).
    baseLevel = intercept + slope * windowKeys.length;
  } else {
    // yoy_growth — needs two year blocks (≥24 complete ideally).
    const g = computeTtmYoyGrowth(normalized, completeAll, input.excludedMonths);
    if (g == null || completeAll.length < 24) {
      return { historical, projected: [], trendPerMonth: 0 };
    }
    useYoy = true;
    yoyG = g;
    baseLevel = computeL0(normalized, lastNFromCompleteMonths(completeAll, 12)) ?? 0;
    trendPerMonth = (baseLevel * yoyG) / 12;
  }

  const lastComplete = completeAll[completeAll.length - 1]!;
  const projected: ProjectedPoint[] = [];
  for (let t = 1; t <= horizon; t++) {
    const m = addMonths(lastComplete, t);
    let value: number;
    if (useYoy) {
      value = baseLevel * Math.pow(1 + yoyG, t / 12);
    } else if (input.method === "linear_trend") {
      value = baseLevel + trendPerMonth * (t - 1);
    } else {
      value = baseLevel;
    }
    const idx = input.seasonalIndex?.[calendarMonth(m)];
    if (idx != null && Number.isFinite(idx)) value *= idx;
    value *= factor;
    projected.push({
      month: ym(m),
      value,
      projected: true,
    });
  }

  return { historical, projected, trendPerMonth };
}
