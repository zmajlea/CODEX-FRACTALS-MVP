/**
 * INVARIANT: no server-only imports. Shared by API validation and Analytics shell.
 * Studies are operator-owned; not sealed; client never sees them.
 */

import type {
  CashModelDerivedSnapshot,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import type { SpendPlanScenario, SeasonalIndexResult } from "@/lib/treasury/spend-plan";

export type StudyType = "spend_plan" | "cash_model";

export type StudyScope = {
  accountId: string;
  label: string | null;
};

export type StudyBaselineOverrides = {
  /** Non-null ⇒ chip as adjusted (kept-stale or explicit override), not pulled. */
  l0: number | null;
  buffer: number | null;
  /** Non-null ⇒ use as fixedSeasonalIndices; chip indices as adjusted. */
  seasonalIndices: Record<number, number> | null;
};

export type StudyExcludedMonth = {
  month: string; // YYYY-MM
  reason: string;
};

export type StudyParams = {
  base: number;
  step: number;
  stepEveryMonths: number;
  horizon: number;
  startMonth: string;
  bufferAdjustment: number;
  overrides: StudyBaselineOverrides;
  /** Spec 38B — judgment view over the sample; never deletes transactions. */
  excludedMonths: StudyExcludedMonth[];
  backtest: {
    startMonth: string;
    months: number;
    startingBuffer: number;
  };
};

export type DerivedSnapshot = {
  l0: number;
  l0Window: string[];
  seasonalIndices: Record<number, number>;
  seasonalMissingMonths: number[];
  seasonalityDisabled: boolean;
  ttmYoy: number | null;
  buffer: {
    value: number | null;
    source: "available_balance" | "current_balance" | null;
    asOf: string;
  } | null;
  asOf: string;
  excludedPartialMonth: string | null;
  historyMonthCount: number;
};

export type TreasuryStudyRowBase = {
  id: string;
  client_user_id: string;
  operator_tenant_id: string | null;
  created_by: string | null;
  name: string;
  is_primary: boolean;
  scope: StudyScope;
  created_at: string;
  updated_at: string;
};

export type SpendPlanStudyRow = TreasuryStudyRowBase & {
  type: "spend_plan";
  params: StudyParams;
  scenarios: SpendPlanScenario[];
  derived_snapshot: DerivedSnapshot;
};

export type CashModelStudyRow = TreasuryStudyRowBase & {
  type: "cash_model";
  params: CashModelParams;
  scenarios: CashModelScenario[];
  derived_snapshot: CashModelDerivedSnapshot;
};

export type TreasuryStudyRow = SpendPlanStudyRow | CashModelStudyRow;

export type DriftField =
  | "l0"
  | "buffer"
  | "ttmYoy"
  | "historyMonthCount"
  | "excludedPartialMonth"
  | "l0Window"
  | "seasonalIndices";

export type DriftEntry = {
  field: DriftField;
  saved: unknown;
  current: unknown;
  /** For seasonalIndices: calendar months 1–12 that differ. */
  affectedMonths?: number[];
};

const INDEX_EPS = 1e-9;
const NUM_EPS = 0.5;

function nearlyEqual(a: number, b: number, eps = NUM_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

function indicesEqual(
  a: Record<number, number>,
  b: Record<number, number>
): { equal: boolean; affected: number[] } {
  const affected: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const av = a[m] ?? 1;
    const bv = b[m] ?? 1;
    if (Math.abs(av - bv) > INDEX_EPS) affected.push(m);
  }
  return { equal: affected.length === 0, affected };
}

function windowEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Compare frozen save-time snapshot to freshly recomputed current. */
export function diffDerivedSnapshot(
  saved: DerivedSnapshot,
  current: DerivedSnapshot
): DriftEntry[] {
  const out: DriftEntry[] = [];

  if (!nearlyEqual(saved.l0, current.l0)) {
    out.push({ field: "l0", saved: saved.l0, current: current.l0 });
  }

  const savedBuf = saved.buffer?.value ?? null;
  const curBuf = current.buffer?.value ?? null;
  if (savedBuf !== curBuf && !(savedBuf != null && curBuf != null && nearlyEqual(savedBuf, curBuf))) {
    out.push({ field: "buffer", saved: savedBuf, current: curBuf });
  }

  const savedTtm = saved.ttmYoy;
  const curTtm = current.ttmYoy;
  if (savedTtm == null || curTtm == null) {
    if (savedTtm !== curTtm) {
      out.push({ field: "ttmYoy", saved: savedTtm, current: curTtm });
    }
  } else if (!nearlyEqual(savedTtm, curTtm, 1e-6)) {
    out.push({ field: "ttmYoy", saved: savedTtm, current: curTtm });
  }

  if (saved.historyMonthCount !== current.historyMonthCount) {
    out.push({
      field: "historyMonthCount",
      saved: saved.historyMonthCount,
      current: current.historyMonthCount,
    });
  }

  if (saved.excludedPartialMonth !== current.excludedPartialMonth) {
    out.push({
      field: "excludedPartialMonth",
      saved: saved.excludedPartialMonth,
      current: current.excludedPartialMonth,
    });
  }

  if (!windowEqual(saved.l0Window, current.l0Window)) {
    out.push({
      field: "l0Window",
      saved: saved.l0Window,
      current: current.l0Window,
    });
  }

  const idx = indicesEqual(saved.seasonalIndices, current.seasonalIndices);
  if (!idx.equal) {
    out.push({
      field: "seasonalIndices",
      saved: saved.seasonalIndices,
      current: current.seasonalIndices,
      affectedMonths: idx.affected,
    });
  }

  return out;
}

/**
 * Keep saved → overrides for drifted fields only.
 * Kept-stale baselines are adjusted (diverge from pulled), never written back as pulled.
 */
export function overridesFromKeepSaved(
  saved: DerivedSnapshot,
  drift: DriftEntry[],
  prior: StudyBaselineOverrides = {
    l0: null,
    buffer: null,
    seasonalIndices: null,
  }
): StudyBaselineOverrides {
  const next: StudyBaselineOverrides = { ...prior };
  for (const d of drift) {
    if (d.field === "l0") next.l0 = saved.l0;
    if (d.field === "buffer") next.buffer = saved.buffer?.value ?? null;
    if (d.field === "seasonalIndices") {
      next.seasonalIndices = { ...saved.seasonalIndices };
    }
  }
  return next;
}

export function emptyOverrides(): StudyBaselineOverrides {
  return { l0: null, buffer: null, seasonalIndices: null };
}

export function buildDerivedSnapshot(input: {
  l0: number;
  l0Window: string[];
  seasonal: SeasonalIndexResult;
  ttmYoy: number | null;
  buffer: DerivedSnapshot["buffer"];
  asOf: string;
  excludedPartialMonth: string | null;
  historyMonthCount: number;
}): DerivedSnapshot {
  return {
    l0: input.l0,
    l0Window: input.l0Window,
    seasonalIndices: input.seasonal.indices,
    seasonalMissingMonths: input.seasonal.missingMonths,
    seasonalityDisabled: input.seasonal.seasonalityDisabled,
    ttmYoy: input.ttmYoy,
    buffer: input.buffer,
    asOf: input.asOf,
    excludedPartialMonth: input.excludedPartialMonth,
    historyMonthCount: input.historyMonthCount,
  };
}

export function defaultStudyParams(partial: {
  base: number;
  startMonth: string;
  backtestStart: string;
  backtestMonths: number;
  excludedMonths?: StudyExcludedMonth[];
}): StudyParams {
  return {
    base: partial.base,
    step: 0,
    stepEveryMonths: 3,
    horizon: 24,
    startMonth: partial.startMonth,
    bufferAdjustment: 0,
    overrides: emptyOverrides(),
    excludedMonths: partial.excludedMonths ?? [],
    backtest: {
      startMonth: partial.backtestStart,
      months: partial.backtestMonths,
      startingBuffer: 0,
    },
  };
}
