/**
 * cash_model (Runway) — registry entry. No new maths; wraps existing compose path.
 */
import { z } from "zod";
import { composeCashModelResponse } from "@/lib/treasury/cash-model-compose";
import {
  isCashModelParams,
  isCashModelScenarioArray,
  type CashModelDerivedSnapshot,
  type CashModelParams,
  type CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import { placedStudyFromCashModelCompute } from "@/lib/treasury/study-assemble";
import type {
  CashModelComputeResult,
  ModelKindDef,
  ModelRowLike,
} from "@/lib/treasury/model-kinds/types";

export const cashModelParamsSchema = z.custom<CashModelParams>(isCashModelParams);
export const cashModelScenariosSchema = z.custom<CashModelScenario[]>(
  isCashModelScenarioArray
);

const CASH_MODEL_EXPLAIN =
  "Trailing-mean run-rate by bucket × scenario factors; runway from opening balance to floor.";

export const cashModelKind: ModelKindDef<
  CashModelParams,
  CashModelScenario[],
  CashModelComputeResult
> = {
  type: "cash_model",
  label: "Runway",
  description: "Project ending cash from ledger run-rates and scenario factors.",
  family: "projection",
  listed: true,
  params: cashModelParamsSchema,
  scenarios: cashModelScenariosSchema,
  form: [
    { key: "horizon", label: "Horizon (months)", kind: "number" },
    { key: "openingBalance", label: "Opening balance", kind: "number" },
    { key: "selectedScenarioId", label: "Scenario", kind: "select" },
  ],
  inputs: ["monthly_by_category", "monthly_by_bucket", "account_buffer"],
  placeable() {
    return true;
  },
  asOf(row) {
    const d = row.derived_snapshot as CashModelDerivedSnapshot | null;
    return String(d?.asOf ?? "").slice(0, 10);
  },
  compute(inputs, params, scenarios) {
    const loaded = inputs.cashModel;
    if (!loaded) return null;
    const composed = composeCashModelResponse(loaded, params, scenarios);
    return {
      composed: {
        ...composed,
        derived_snapshot: {
          ...composed.derived_snapshot,
          openingBalance: loaded.openingBalanceRaw,
        },
      },
      openingBalanceSource: loaded.openingBalanceSource,
    };
  },
  toSnapshot(row, inputs, params, scenarios, result) {
    const { composed, openingBalanceSource } = result;
    return placedStudyFromCashModelCompute({
      studyId: String(row.id ?? "preview"),
      name: String(row.name ?? "Runway"),
      asOf: composed.asOf,
      openingBalanceRaw: inputs.cashModel?.openingBalanceRaw ?? null,
      openingBalanceSource,
      timeline: composed.timeline,
      summaries: composed.summaries,
      params,
      scenarios,
      derived: composed.derived_snapshot,
    });
  },
  confidence(_inputs, _params, result) {
    const n = result.composed.derived_snapshot.historyMonthCount ?? 0;
    if (n >= 18) {
      return {
        grade: "solid",
        reasons: [`${n} history months`],
        historyMonthCount: n,
        cyclesObserved: Math.floor(n / 12),
      };
    }
    if (n >= 6) {
      return {
        grade: "indicative",
        reasons: [`${n} history months — under two seasonal cycles`],
        historyMonthCount: n,
        cyclesObserved: Math.floor(n / 12),
      };
    }
    return {
      grade: "thin",
      reasons: [`Only ${n} history months`],
      historyMonthCount: n,
    };
  },
  explain() {
    return CASH_MODEL_EXPLAIN;
  },
  derived(result) {
    return result.composed.derived_snapshot as unknown as Record<string, unknown>;
  },
};

export function cashModelRowAsOf(row: ModelRowLike): string {
  return cashModelKind.asOf(row);
}
