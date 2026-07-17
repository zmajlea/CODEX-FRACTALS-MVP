/**
 * INVARIANT: no server-only imports. This module runs on BOTH server and client so the
 * live workbench and the authoritative server compute share one implementation.
 * Do not add DB/env dependencies.
 *
 * spend(t)      = L0 × (1+g)^(t/12) × index(calendarMonth(t))
 * allocation(t) = base + step × FLOOR((t−1)/stepEveryMonths)
 * cumulative(t) = startingBuffer + Σ(allocation(i) − spend(i))
 */

import {
  addMonths,
  startOfMonth,
  subtractMonths,
} from "@/lib/treasury/period-bounds";

export type SpendPlanScenario = {
  id: string;
  name: string;
  growthPct: number;
  source: "assumed" | "pulled";
};

export type InputProvenance = "user-provided" | "assumed" | "pulled" | "adjusted";

export type SpendPlanInput = {
  key: string;
  label: string;
  value: number | string;
  provenance: InputProvenance;
  editable?: boolean;
};

export type SpendPlanMonthRow = {
  month: string;
  t: number;
  allocation: number;
  seasonalIndex: number;
  spendByScenario: Record<string, number>;
  cumulativeByScenario: Record<string, number>;
};

export type SpendPlanBacktestRow = {
  month: string;
  t: number;
  allocation: number;
  actualDebits: number;
  surplus: number;
  cumulative: number;
};

export type SpendPlanScenarioSummary = {
  scenarioId: string;
  scenarioName: string;
  deficitMonths: number;
  minCumulative: number;
  endingPosition: number;
  firstNegativeMonth: number | null;
};

export type SeasonalIndexResult = {
  indices: Record<number, number>;
  missingMonths: number[];
  seasonalityDisabled: boolean;
  distinctMonthsInWindow: number;
};

export type SpendPlanHistoryResponse = {
  accountId: string;
  label: string | null;
  asOf: string;
  monthlyOutflows: Record<string, number>;
  completeMonths: string[];
  excludedPartialMonth: string | null;
  buffer: {
    value: number | null;
    source: "available_balance" | "current_balance" | null;
    asOf: string;
  } | null;
  historyMonthCount: number;
  firstMonth: string | null;
  lastCompleteMonth: string | null;
};

export const SPEND_PLAN_METHOD_NOTE =
  'Projected spend for month t = L0 × (1+g)^(t/12) × seasonal index of that calendar month. Seasonal indices from history. Allocation for month t = base + step × FLOOR((t−1)/stepEveryMonths). Cumulative position = starting buffer + running sum of (allocation − spend).';

/**
 * ORACLE ONLY — Tim's published 2dp seasonal indices (AL_Finance_PD_Stress_Test).
 * Assert computed indices rounded to 2dp equal these. NEVER feed into projectSpendPlan:
 * that reintroduced the phantom 3.5% gap (display rounding in arithmetic).
 * Screenshots: CODEXONE/170726-R1-anallyzer/image01|02|03.png
 */
export const TIM_SEASONAL_INDICES: Record<number, number> = {
  1: 1.18,
  2: 1.05,
  3: 0.75,
  4: 1.03,
  5: 1.01,
  6: 1.16,
  7: 0.86,
  8: 1.15,
  9: 0.69,
  10: 1.02,
  11: 0.97,
  12: 1.12,
};

function parseMonthStart(iso: string): string {
  return startOfMonth(iso.slice(0, 10));
}

function monthEnd(monthStart: string): string {
  const d = new Date(monthStart + "T12:00:00Z");
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

function calendarMonthNumber(monthStart: string): number {
  const d = new Date(monthStart + "T12:00:00Z");
  return d.getUTCMonth() + 1;
}

/** Month is complete when its last day is strictly before asOf. */
export function isCompleteMonth(monthStart: string, asOf: string): boolean {
  return monthEnd(monthStart) < asOf.slice(0, 10);
}

export function deriveDataSpan(monthlyOutflows: Record<string, number>): {
  firstMonth: string | null;
  lastMonth: string | null;
} {
  const keys = Object.keys(monthlyOutflows).sort();
  if (keys.length === 0) return { firstMonth: null, lastMonth: null };
  return { firstMonth: keys[0]!, lastMonth: keys[keys.length - 1]! };
}

/** Complete months within dataSpan only — never calendar ranges outside data. */
export function deriveCompleteMonths(
  monthlyOutflows: Record<string, number>,
  asOf: string
): string[] {
  const { firstMonth, lastMonth } = deriveDataSpan(monthlyOutflows);
  if (!firstMonth || !lastMonth) return [];

  const out: string[] = [];
  let cur = parseMonthStart(firstMonth);
  const end = parseMonthStart(lastMonth);
  while (cur <= end) {
    if (isCompleteMonth(cur, asOf)) out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function lastNFromCompleteMonths(
  completeMonths: string[],
  n: number
): string[] {
  if (n <= 0) return [];
  return completeMonths.slice(-n);
}

/** Amounts for complete months; genuine zeros inside dataSpan, never ??0 outside span. */
export function fillCompleteMonthAmounts(
  monthlyOutflows: Record<string, number>,
  completeMonths: string[]
): Record<string, number> {
  const filled: Record<string, number> = {};
  for (const m of completeMonths) {
    filled[m] = monthlyOutflows[m] ?? 0;
  }
  return filled;
}

export function seasonalWindowFromCompleteMonths(
  completeMonths: string[],
  windowMonths = 24
): string[] {
  return completeMonths.slice(-windowMonths);
}

/** Last complete month strictly before plan start (may be partial → excluded). */
export function excludedPartialMonthBeforeStart(
  planStartMonth: string,
  asOf: string
): string | null {
  const prior = subtractMonths(parseMonthStart(planStartMonth), 1);
  if (!isCompleteMonth(prior, asOf)) return prior.slice(0, 7);
  return null;
}

/** @deprecated Use deriveCompleteMonths + lastNFromCompleteMonths for L0. */
export function lastNCompleteMonthsBeforeStart(
  planStartMonth: string,
  asOf: string,
  n: number
): string[] {
  const out: string[] = [];
  let cur = subtractMonths(parseMonthStart(planStartMonth), 1);
  let guard = 0;
  while (out.length < n && guard < 120) {
    if (isCompleteMonth(cur, asOf)) out.unshift(cur);
    cur = subtractMonths(cur, 1);
    guard += 1;
  }
  return out;
}

export function defaultPlanStartMonth(asOf: string): string {
  const d = new Date(asOf.slice(0, 10) + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return startOfMonth(
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
  );
}

export function roundBaseDefault(l0: number): number {
  return Math.round(l0 / 1000) * 1000;
}

export function allocationForMonth(
  t: number,
  base: number,
  step: number,
  stepEveryMonths = 3
): number {
  const interval = Math.max(1, Math.min(12, stepEveryMonths));
  return base + step * Math.floor((t - 1) / interval);
}

export function computeL0(
  monthlyDebits: Record<string, number>,
  monthKeys: string[]
): number | null {
  if (monthKeys.length === 0) return null;
  const vals = monthKeys.map((k) => monthlyDebits[k] ?? 0);
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * Cut complete months into whole 12-month blocks counted back from the last
 * complete month. Orphan months older than the last whole block are unused
 * (they'd re-introduce trend into the indices).
 */
export function partitionIntoYearBlocks(completeMonthKeys: string[]): string[][] {
  const sorted = [...completeMonthKeys].sort();
  const nBlocks = Math.floor(sorted.length / 12);
  if (nBlocks < 1) return [];
  const usable = sorted.slice(-nBlocks * 12);
  const blocks: string[][] = [];
  for (let i = 0; i < nBlocks; i++) {
    blocks.push(usable.slice(i * 12, (i + 1) * 12));
  }
  return blocks;
}

export function meanOfMonths(
  monthlyDebits: Record<string, number>,
  monthKeys: string[]
): number {
  if (monthKeys.length === 0) return 0;
  const sum = monthKeys.reduce((s, k) => s + (monthlyDebits[k] ?? 0), 0);
  return sum / monthKeys.length;
}

/** Normalize to YYYY-MM for exclusion matching. */
export function monthYm(isoOrYm: string): string {
  return isoOrYm.slice(0, 7);
}

export function toExcludedSet(
  excluded?: Iterable<string> | null
): Set<string> {
  const set = new Set<string>();
  if (!excluded) return set;
  for (const m of excluded) set.add(monthYm(m));
  return set;
}

/**
 * Tim's seasonal index method (Spec 38A / 38B):
 *   index(M) = mean over blocks of ( debits(block, M) ÷ mean(months present in block) )
 *
 * Block boundaries use all complete months (counted back from last complete).
 * Exclusions omit months from the mean and from that month's ratio — they do not
 * collapse year boundaries. Self-normalising over months present; do NOT
 * renormalise globally afterwards.
 */
export function computeSeasonalIndices(
  monthlyDebits: Record<string, number>,
  monthKeys: string[],
  asOf: string,
  excludedMonths?: Iterable<string> | null
): SeasonalIndexResult {
  const excluded = toExcludedSet(excludedMonths);
  const completeKeys = monthKeys
    .filter((k) => isCompleteMonth(k, asOf))
    .sort();
  const distinct = new Set(completeKeys.map((k) => k.slice(0, 7))).size;

  if (distinct < 12) {
    const indices: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) indices[m] = 1;
    return {
      indices,
      missingMonths: [],
      seasonalityDisabled: true,
      distinctMonthsInWindow: distinct,
    };
  }

  const blocks = partitionIntoYearBlocks(completeKeys);
  const indices: Record<number, number> = {};
  const missingMonths: number[] = [];

  for (let m = 1; m <= 12; m++) {
    const ratios: number[] = [];
    for (const block of blocks) {
      const present = block.filter((k) => !excluded.has(monthYm(k)));
      const blockMean = meanOfMonths(monthlyDebits, present);
      if (blockMean === 0 || present.length === 0) continue;
      const key = block.find((k) => calendarMonthNumber(k) === m);
      if (!key || excluded.has(monthYm(key))) continue;
      ratios.push((monthlyDebits[key] ?? 0) / blockMean);
    }
    if (ratios.length === 0) {
      indices[m] = 1;
      missingMonths.push(m);
    } else {
      indices[m] = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    }
  }

  return {
    indices,
    missingMonths,
    seasonalityDisabled: false,
    distinctMonthsInWindow: distinct,
  };
}

/**
 * History-repeats growth = mean(latest block present) ÷ mean(previous block present) − 1.
 *
 * For two full 12-month blocks this equals sum(last12)/sum(prior12)−1
 * (the ÷12 cancels). Mean/mean generalises correctly when 38B exclusions
 * shorten a block — sum/sum would silently mis-weight the shorter block.
 */
export function computeTtmYoyGrowth(
  monthlyDebits: Record<string, number>,
  completeMonthKeys: string[],
  excludedMonths?: Iterable<string> | null
): number | null {
  const excluded = toExcludedSet(excludedMonths);
  const blocks = partitionIntoYearBlocks(completeMonthKeys);
  if (blocks.length < 2) return null;
  const latest = blocks[blocks.length - 1]!.filter(
    (k) => !excluded.has(monthYm(k))
  );
  const previous = blocks[blocks.length - 2]!.filter(
    (k) => !excluded.has(monthYm(k))
  );
  const meanLatest = meanOfMonths(monthlyDebits, latest);
  const meanPrevious = meanOfMonths(monthlyDebits, previous);
  if (meanPrevious === 0 || previous.length === 0 || latest.length === 0) {
    return null;
  }
  return meanLatest / meanPrevious - 1;
}

/** Round indices to 2dp for display / oracle asserts — never for projection. */
export function roundSeasonalIndices2dp(
  indices: Record<number, number>
): Record<number, number> {
  const out: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    out[m] = Math.round((indices[m] ?? 1) * 100) / 100;
  }
  return out;
}

export function buildDefaultScenarios(ttmYoy: number | null): SpendPlanScenario[] {
  const scenarios: SpendPlanScenario[] = [
    { id: "flat", name: "Flat", growthPct: 0, source: "assumed" },
    { id: "plus15", name: "+15%", growthPct: 0.15, source: "assumed" },
    { id: "plus30", name: "+30%", growthPct: 0.3, source: "assumed" },
  ];
  if (ttmYoy !== null) {
    scenarios.push({
      id: "history-repeats",
      name: "History repeats",
      growthPct: ttmYoy,
      source: "pulled",
    });
  }
  return scenarios;
}

export type ProjectSpendPlanParams = {
  startMonth: string;
  horizon: number;
  startingBuffer: number;
  l0: number;
  base: number;
  step: number;
  stepEveryMonths?: number;
  seasonalIndices: Record<number, number>;
  scenarios: SpendPlanScenario[];
};

export function projectSpendPlan(
  params: ProjectSpendPlanParams
): SpendPlanMonthRow[] {
  const start = parseMonthStart(params.startMonth);
  const stepEveryMonths = params.stepEveryMonths ?? 3;
  const rows: SpendPlanMonthRow[] = [];
  const cumulative: Record<string, number> = {};

  for (const sc of params.scenarios) {
    cumulative[sc.id] = params.startingBuffer;
  }

  for (let t = 1; t <= params.horizon; t++) {
    const month = addMonths(start, t - 1);
    const cal = calendarMonthNumber(month);
    const idx = params.seasonalIndices[cal] ?? 1;
    const allocation = allocationForMonth(
      t,
      params.base,
      params.step,
      stepEveryMonths
    );
    const spendByScenario: Record<string, number> = {};
    const cumulativeByScenario: Record<string, number> = {};

    for (const sc of params.scenarios) {
      const rawSpend =
        params.l0 * Math.pow(1 + sc.growthPct, t / 12) * idx;
      const spend = Math.round(rawSpend);
      spendByScenario[sc.id] = spend;
      cumulative[sc.id]! += allocation - spend;
      cumulativeByScenario[sc.id] = Math.round(cumulative[sc.id]! * 100) / 100;
    }

    rows.push({
      month,
      t,
      allocation,
      seasonalIndex: idx,
      spendByScenario,
      cumulativeByScenario,
    });
  }

  return rows;
}

export type BacktestSpendPlanParams = {
  startMonth: string;
  startingBuffer: number;
  base: number;
  step: number;
  stepEveryMonths?: number;
  actualDebits: Record<string, number>;
  monthCount: number;
};

export function backtestSpendPlan(
  params: BacktestSpendPlanParams
): SpendPlanBacktestRow[] {
  const start = parseMonthStart(params.startMonth);
  const stepEveryMonths = params.stepEveryMonths ?? 3;
  const rows: SpendPlanBacktestRow[] = [];
  let cumulative = params.startingBuffer;

  for (let t = 1; t <= params.monthCount; t++) {
    const month = addMonths(start, t - 1);
    const allocation = allocationForMonth(
      t,
      params.base,
      params.step,
      stepEveryMonths
    );
    const actualDebits = params.actualDebits[month] ?? 0;
    const surplus = allocation - actualDebits;
    cumulative += surplus;
    rows.push({
      month,
      t,
      allocation,
      actualDebits,
      surplus: Math.round(surplus * 100) / 100,
      cumulative: Math.round(cumulative * 100) / 100,
    });
  }

  return rows;
}

export function summarizeScenarios(
  rows: SpendPlanMonthRow[],
  scenarios: SpendPlanScenario[]
): SpendPlanScenarioSummary[] {
  return scenarios.map((scenario) => {
    let deficitMonths = 0;
    let minCumulative = Infinity;
    let endingPosition = 0;
    let firstNegativeMonth: number | null = null;

    for (const row of rows) {
      const spend = row.spendByScenario[scenario.id] ?? 0;
      if (spend > row.allocation) deficitMonths += 1;
      const cum = row.cumulativeByScenario[scenario.id] ?? 0;
      if (cum < minCumulative) minCumulative = cum;
      endingPosition = cum;
      if (firstNegativeMonth === null && cum < 0) {
        firstNegativeMonth = row.t;
      }
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      deficitMonths,
      minCumulative: minCumulative === Infinity ? 0 : minCumulative,
      endingPosition,
      firstNegativeMonth,
    };
  });
}

export function countNegativeSurplusMonths(rows: SpendPlanBacktestRow[]): number {
  return rows.filter((r) => r.surplus < 0).length;
}

export type SpendPlanDeriveInput = {
  monthlyOutflows: Record<string, number>;
  asOf: string;
  planStartMonth: string;
  horizon: number;
  startingBuffer: number;
  base: number;
  step: number;
  stepEveryMonths?: number;
  scenarios: SpendPlanScenario[];
  fixedSeasonalIndices?: Record<number, number>;
  /** When set, projection uses this L0 instead of the pulled mean (Keep-saved / override). */
  fixedL0?: number;
  /**
   * Spec 38B: judgment months omitted from L0 / indices / history-repeats.
   * YYYY-MM or YYYY-MM-01. Does not touch backtest actuals.
   */
  excludedMonths?: string[];
  backtest?: BacktestSpendPlanParams;
};

export type SpendPlanDerived = {
  completeMonths: string[];
  firstMonth: string | null;
  lastCompleteMonth: string | null;
  l0: number;
  /** Always the mean of the L0 window from data — even when fixedL0 overrides projection. */
  pulledL0: number;
  l0WindowMonths: string[];
  l0ShortWindow: boolean;
  seasonal: SeasonalIndexResult;
  ttmYoy: number | null;
  historyRepeatsUnavailable: boolean;
  historyRepeatsReason?: string;
  excludedPartialMonth: string | null;
  projection: SpendPlanMonthRow[];
  scenarioResults: SpendPlanScenarioSummary[];
  backtest?: SpendPlanBacktestRow[];
  backtestNegativeMonths?: number;
  filledCompleteAmounts: Record<string, number>;
};

export function deriveSpendPlan(input: SpendPlanDeriveInput): SpendPlanDerived {
  const planStart = parseMonthStart(input.planStartMonth);
  const stepEveryMonths = input.stepEveryMonths ?? 3;
  const completeMonths = deriveCompleteMonths(input.monthlyOutflows, input.asOf);
  const excluded = toExcludedSet(input.excludedMonths);
  const { firstMonth } = deriveDataSpan(input.monthlyOutflows);
  const lastCompleteMonth =
    completeMonths.length > 0 ? completeMonths[completeMonths.length - 1]! : null;
  const filledCompleteAmounts = fillCompleteMonthAmounts(
    input.monthlyOutflows,
    completeMonths
  );

  // L0: last 6 complete months still in the sample (exclusions are a view)
  const sampleMonths = completeMonths.filter((m) => !excluded.has(monthYm(m)));
  const l0WindowMonths = lastNFromCompleteMonths(sampleMonths, 6);
  const pulledL0 = computeL0(filledCompleteAmounts, l0WindowMonths) ?? 0;
  const l0 = input.fixedL0 ?? pulledL0;
  const l0ShortWindow = l0WindowMonths.length > 0 && l0WindowMonths.length < 6;

  const seasonalKeys = seasonalWindowFromCompleteMonths(completeMonths, 24);
  const seasonal =
    input.fixedSeasonalIndices != null
      ? {
          indices: input.fixedSeasonalIndices,
          missingMonths: [] as number[],
          seasonalityDisabled: false,
          distinctMonthsInWindow: 24,
        }
      : computeSeasonalIndices(
          filledCompleteAmounts,
          seasonalKeys,
          input.asOf,
          excluded
        );

  const ttmYoy = computeTtmYoyGrowth(
    filledCompleteAmounts,
    completeMonths,
    excluded
  );
  const hasHistoryRepeats = input.scenarios.some(
    (s) => s.id === "history-repeats"
  );
  const historyRepeatsUnavailable = !hasHistoryRepeats && ttmYoy === null;
  const historyRepeatsReason = historyRepeatsUnavailable
    ? completeMonths.length < 24
      ? `needs 24 complete months; have ${completeMonths.length}`
      : "TTM YoY could not be computed from history"
    : undefined;

  const excludedPartialMonth = excludedPartialMonthBeforeStart(
    planStart,
    input.asOf
  );

  const projection = projectSpendPlan({
    startMonth: planStart,
    horizon: input.horizon,
    startingBuffer: input.startingBuffer,
    l0,
    base: input.base,
    step: input.step,
    stepEveryMonths,
    seasonalIndices: seasonal.indices,
    scenarios: input.scenarios,
  });

  const scenarioResults = summarizeScenarios(projection, input.scenarios);

  let backtestRows: SpendPlanBacktestRow[] | undefined;
  let backtestNegativeMonths: number | undefined;
  // Backtest uses unfiltered actuals — exclusions are a note, never a recomputation
  if (input.backtest) {
    backtestRows = backtestSpendPlan({
      ...input.backtest,
      stepEveryMonths,
    });
    backtestNegativeMonths = countNegativeSurplusMonths(backtestRows);
  }

  return {
    completeMonths,
    firstMonth,
    lastCompleteMonth,
    l0,
    pulledL0,
    l0WindowMonths,
    l0ShortWindow,
    seasonal,
    ttmYoy,
    historyRepeatsUnavailable,
    historyRepeatsReason,
    excludedPartialMonth,
    projection,
    scenarioResults,
    backtest: backtestRows,
    backtestNegativeMonths,
    filledCompleteAmounts,
  };
}

export type SpendPlanResponse = {
  methodNote: string;
  inputs: SpendPlanInput[];
  seasonalIndices: Record<number, number>;
  seasonalityDisabled: boolean;
  missingSeasonalMonths: number[];
  excludedPartialMonth: string | null;
  l0WindowMonths: string[];
  historyRepeatsUnavailable?: boolean;
  historyRepeatsReason?: string;
  projection: SpendPlanMonthRow[];
  scenarioResults: SpendPlanScenarioSummary[];
  scenarios: SpendPlanScenario[];
  backtest?: SpendPlanBacktestRow[];
  backtestNegativeMonths?: number;
};

export function buildSpendPlanFromHistory(input: {
  planStartMonth: string;
  asOf: string;
  horizon: number;
  startingBuffer: number;
  base: number;
  step: number;
  stepEveryMonths?: number;
  monthlyDebits: Record<string, number>;
  scenarios?: SpendPlanScenario[];
  fixedSeasonalIndices?: Record<number, number>;
  fixedL0?: number;
  /** When true, starting_buffer chip is adjusted (kept-stale), not pulled. */
  bufferAdjusted?: boolean;
  excludedMonths?: string[];
  backtest?: BacktestSpendPlanParams;
}): SpendPlanResponse {
  const planStart = parseMonthStart(input.planStartMonth);
  const completeMonths = deriveCompleteMonths(input.monthlyDebits, input.asOf);
  const filled = fillCompleteMonthAmounts(input.monthlyDebits, completeMonths);
  const ttmYoy = computeTtmYoyGrowth(
    filled,
    completeMonths,
    input.excludedMonths
  );
  const scenarios =
    input.scenarios ?? buildDefaultScenarios(ttmYoy);

  const derived = deriveSpendPlan({
    monthlyOutflows: input.monthlyDebits,
    asOf: input.asOf,
    planStartMonth: planStart,
    horizon: input.horizon,
    startingBuffer: input.startingBuffer,
    base: input.base,
    step: input.step,
    stepEveryMonths: input.stepEveryMonths,
    scenarios,
    fixedSeasonalIndices: input.fixedSeasonalIndices,
    fixedL0: input.fixedL0,
    excludedMonths: input.excludedMonths,
    backtest: input.backtest,
  });

  const historyScenario = scenarios.find((s) => s.id === "history-repeats");
  const l0Adjusted = input.fixedL0 != null;
  const indicesAdjusted = input.fixedSeasonalIndices != null;

  const inputs: SpendPlanInput[] = [
    {
      key: "base",
      label: "Monthly allocation",
      value: input.base,
      provenance: "user-provided",
      editable: true,
    },
    {
      key: "step",
      label: "Allocation step-up",
      value: input.step,
      provenance: "user-provided",
      editable: true,
    },
    {
      key: "step_every_months",
      label: "Step every (months)",
      value: input.stepEveryMonths ?? 3,
      provenance: "user-provided",
      editable: true,
    },
    {
      key: "horizon",
      label: "Horizon (months)",
      value: input.horizon,
      provenance: "assumed",
      editable: true,
    },
    {
      key: "start_month",
      label: "Plan start month",
      value: planStart.slice(0, 7),
      provenance: "assumed",
      editable: true,
    },
    {
      key: "starting_buffer",
      label: "Starting cash buffer",
      value: input.startingBuffer,
      provenance: input.bufferAdjusted ? "adjusted" : "pulled",
      editable: false,
    },
    {
      key: "l0",
      label: "Baseline monthly spend (L0)",
      value: Math.round(derived.l0),
      provenance: l0Adjusted ? "adjusted" : "pulled",
      editable: false,
    },
  ];

  if (l0Adjusted) {
    inputs.push({
      key: "l0_pulled",
      label: "L0 (current pulled)",
      value: Math.round(derived.pulledL0),
      provenance: "pulled",
      editable: false,
    });
  }

  if (indicesAdjusted) {
    inputs.push({
      key: "seasonal_indices",
      label: "Seasonal indices",
      value: "kept from save",
      provenance: "adjusted",
      editable: false,
    });
  }

  if (historyScenario) {
    inputs.push({
      key: "history_repeats_growth",
      label: "History repeats growth (TTM YoY)",
      value: `${(historyScenario.growthPct * 100).toFixed(1)}%`,
      provenance: historyScenario.source,
      editable: false,
    });
  }

  return {
    methodNote: SPEND_PLAN_METHOD_NOTE,
    inputs,
    seasonalIndices: derived.seasonal.indices,
    seasonalityDisabled: derived.seasonal.seasonalityDisabled,
    missingSeasonalMonths: derived.seasonal.missingMonths,
    excludedPartialMonth: derived.excludedPartialMonth,
    l0WindowMonths: derived.l0WindowMonths,
    historyRepeatsUnavailable: derived.historyRepeatsUnavailable,
    historyRepeatsReason: derived.historyRepeatsReason,
    projection: derived.projection,
    scenarioResults: derived.scenarioResults,
    scenarios,
    backtest: derived.backtest,
    backtestNegativeMonths: derived.backtestNegativeMonths,
  };
}

/** @deprecated Use seasonalWindowFromCompleteMonths */
export function seasonalWindowMonthKeys(
  planStartMonth: string,
  asOf: string,
  windowMonths = 24
): string[] {
  const end = lastNCompleteMonthsBeforeStart(planStartMonth, asOf, 1)[0];
  if (!end) return [];
  const keys: string[] = [];
  let cur = subtractMonths(end, windowMonths - 1);
  const endMonth = end;
  while (cur <= endMonth) {
    if (isCompleteMonth(cur, asOf)) keys.push(cur);
    cur = addMonths(cur, 1);
  }
  return keys;
}
