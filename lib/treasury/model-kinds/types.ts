/**
 * Models rethink Phase 1 — kind registry types (pure; no server-only).
 * Product word: Model. Physical table: treasury_studies.
 */

import type { z } from "zod";
import type { CashModelComposedResponse } from "@/lib/treasury/cash-model-compose";
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

/** Phase 1 loaders backed today; metric_series etc. arrive in Phase 2. */
export type InputLoaderKey =
  | "monthly_by_category"
  | "monthly_by_bucket"
  | "account_buffer";

export type ParamField = {
  key: string;
  label: string;
  kind: "number" | "text" | "select" | "months" | "json";
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
 * Phase 1 kind contract. Form/defaults/drift deepen in Phase 2;
 * stubs keep the shape stable for Studio.
 *
 * Generic `S` is the **scenarios array** type (e.g. CashModelScenario[]).
 */
export type ModelKindDef<P = unknown, S = unknown[], R = unknown> = {
  type: string;
  label: string;
  description: string;
  family: ModelFamily;
  listed: boolean;
  params: z.ZodType<P>;
  /** Schema for the scenarios array. */
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

/** Cash-model compute result carried through toSnapshot. */
export type CashModelComputeResult = {
  composed: CashModelComposedResponse;
  openingBalanceSource: OpeningBalanceSource;
};
