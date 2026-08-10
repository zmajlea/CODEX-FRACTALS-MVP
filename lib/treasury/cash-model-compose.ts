/**
 * Spec 65 — shared client/server cash model response assembly.
 */

import { computeCashModel, type CashModelResult } from "@/lib/treasury/cash-model";
import type {
  CashModelDerivedSnapshot,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import { buildRunwayStatus } from "@/lib/treasury/cash-model-status";
import type { MonthlyByCategorySeries } from "@/lib/treasury/load-monthly-by-category";

export type CashModelLoadedInputs = {
  accountId: string;
  asOf: string;
  /** Balance used in compute (0 when unknown). */
  openingBalance: number;
  /** Raw buffer value before fallback — null when unknown. */
  openingBalanceRaw: number | null;
  categorySeries: MonthlyByCategorySeries;
};

export type CashModelComposedResponse = CashModelResult & {
  accountId: string;
  asOf: string;
  openingBalance: number;
  derived_snapshot: CashModelDerivedSnapshot;
};

export function buildCashModelDerivedSnapshot(
  result: CashModelResult,
  params: CashModelParams,
  openingBalanceRaw: number | null,
  asOf: string,
  includeRunwayStatus = false
): CashModelDerivedSnapshot {
  const snapshot: CashModelDerivedSnapshot = {
    bucketBaselines: result.bucketBaselines,
    coveragePct: result.coveragePct,
    bucketMap: params.bucketMap ?? {},
    openingBalance: openingBalanceRaw,
    asOf,
    historyMonthCount: result.completeMonths.length,
    historyDerived: true,
  };
  if (includeRunwayStatus && result.summaries.length > 0) {
    snapshot.runwayStatus = buildRunwayStatus(result.summaries, params);
  }
  return snapshot;
}

export function composeCashModelResponse(
  inputs: CashModelLoadedInputs,
  params: CashModelParams,
  scenarios: CashModelScenario[]
): CashModelComposedResponse {
  const excludedMonthSet = new Set(
    (params.excludedMonths ?? []).map((e) => e.month.slice(0, 7))
  );

  const result = computeCashModel({
    categorySeries: inputs.categorySeries,
    bucketMap: params.bucketMap ?? {},
    openingBalance: inputs.openingBalance,
    asOf: inputs.asOf,
    params,
    scenarios,
    excludedMonthSet,
  });

  return {
    ...result,
    accountId: inputs.accountId,
    asOf: inputs.asOf,
    openingBalance: inputs.openingBalance,
    derived_snapshot: buildCashModelDerivedSnapshot(
      result,
      params,
      inputs.openingBalanceRaw,
      inputs.asOf
    ),
  };
}
