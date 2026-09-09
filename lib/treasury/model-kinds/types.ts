/**
 * Models rethink Phase 1/2 — kind registry types (pure; no server-only).
 * Product word: Model. Physical table: treasury_studies.
 */

import type { z } from "zod";
import type { CashModelComposedResponse } from "@/lib/treasury/cash-model-compose";
import type {
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import type { MonthlyByCategorySeries } from "@/lib/treasury/load-monthly-by-category";
import type { PlacedStudySnapshot } from "@/lib/treasury/study-assemble";

export type ModelFamily =
  | "projection"
  | "decomposition"
  | "ratio"
  | "solve"
  | "external"
  | "legacy";

export type ConfidenceGrade = "solid" | "indicative" | "thin" | "refused";

export type Confidence = {
  grade: ConfidenceGrade;
  reasons: string[];
  historyMonthCount: number;
  cyclesObserved?: number;
};

/** Phase 1 loaders; metric_series deferred. */
export type InputLoaderKey =
  | "monthly_by_category"
  | "monthly_by_bucket"
  | "account_buffer";

export type ParamFieldOption = {
  value: string;
  label: string;
  help?: string;
  disabledReason?: string;
};

export type ParamField = {
  key: string;
  label: string;
  kind:
    | "number"
    | "text"
    | "select"
    | "months"
    | "json"
    | "toggle"
    | "exclude_months"
    | "money";
  options?: ParamFieldOption[];
  min?: number;
  max?: number;
  /** Ledger-seeded hint for Studio source chips. */
  seed?: boolean;
};

export type OpeningBalanceSource = "ledger" | "manual" | "unknown";

export type CashModelLoadedBundle = {
  accountId: string;
  asOf: string;
  openingBalance: number;
  openingBalanceRaw: number | null;
  openingBalanceSource: OpeningBalanceSource;
  categorySeries: MonthlyByCategorySeries;
};

export type LoadedInputs = {
  /** Present when any cash-model loader key was requested. */
  cashModel?: CashModelLoadedBundle;
};

export type ModelRowLike = {
  id?: string;
  name?: string;
  type: string;
  status?: string | null;
  params?: unknown;
  scenarios?: unknown;
  scope?: { accountId?: string } | null;
  derived_snapshot?: unknown;
};

/**
 * Kind contract. Generic `S` is the scenarios *array* type.
 */
export type ModelKindDef<P = unknown, S = unknown[], R = unknown> = {
  type: string;
  label: string;
  description: string;
  family: ModelFamily;
  listed: boolean;
  params: z.ZodType<P>;
  scenarios?: z.ZodType<S>;
  form: ParamField[];
  inputs: InputLoaderKey[];
  placeable(row: ModelRowLike): boolean;
  asOf(row: ModelRowLike): string;
  compute(
    inputs: LoadedInputs,
    params: P,
    scenarios: S,
    row: ModelRowLike
  ): R | null;
  toSnapshot(
    row: ModelRowLike,
    inputs: LoadedInputs,
    params: P,
    scenarios: S,
    result: R
  ): PlacedStudySnapshot;
  confidence(inputs: LoadedInputs, params: P, result: R): Confidence;
  explain(params: P, result: R): string;
  derived?(result: R, inputs: LoadedInputs, params: P): Record<string, unknown>;
};

export type CashModelComputeResult = {
  composed: CashModelComposedResponse;
  openingBalanceSource: OpeningBalanceSource;
  /** Coerced params/scenarios used for compose (Studio synthesis). */
  coercedParams?: CashModelParams;
  coercedScenarios?: CashModelScenario[];
};

/** Read confidence.grade from a stored derived_snapshot (if present). */
export function confidenceGradeFromDerived(
  derived: unknown
): ConfidenceGrade | null {
  if (!derived || typeof derived !== "object") return null;
  const c = (derived as { confidence?: { grade?: unknown } }).confidence;
  const g = c?.grade;
  if (
    g === "solid" ||
    g === "indicative" ||
    g === "thin" ||
    g === "refused"
  ) {
    return g;
  }
  return null;
}

export function defaultStatusPlaceable(status?: string | null): boolean {
  return status !== "pending" && status !== "discarded";
}
