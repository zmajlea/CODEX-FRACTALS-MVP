/**
 * cash_model (Runway) — registry entry. No new maths; wraps existing compose path.
 * Studio-minimal params synthesize RPC-parity defaults + base scenarios in compute
 * so preview and place share one path (B22).
 */
import { z } from "zod";
import { composeCashModelResponse } from "@/lib/treasury/cash-model-compose";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  isCashModelScenarioArray,
  resolveOpeningBalanceOverride,
  type CashModelDerivedSnapshot,
  type CashModelParams,
  type CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import {
  placedStudyFromCashModelCompute,
  scrubPlacedStudySnapshot,
  normalizePlacedStudy,
} from "@/lib/treasury/study-assemble";
import type {
  CashModelComputeResult,
  ModelKindDef,
  ModelRowLike,
} from "@/lib/treasury/model-kinds/types";

/**
 * Studio form keys + passthrough for legacy Ensure payloads (selectedScenarioId,
 * bucketMap, driverSpec, excludedMonths). Form↔zod parity uses .shape only.
 */
export const cashModelParamsSchema = z
  .object({
    accountId: z.string().optional(),
    openingBalance: z.number().nullable().optional(),
    /** Floor — required by Studio UI; optional here so legacy rows still parse. */
    minCashThreshold: z.number().optional(),
    horizon: z.number().int().min(1).max(36),
  })
  .passthrough();

export type CashModelStudioParams = z.infer<typeof cashModelParamsSchema>;

export const cashModelScenariosSchema = z.custom<CashModelScenario[]>(
  (v) => v == null || isCashModelScenarioArray(v)
);

const CASH_MODEL_EXPLAIN =
  "Trailing-mean run-rate by bucket × scenario factors; runway from opening balance to floor.";

/** Fill RPC-parity CashModelParams from Studio-minimal or legacy payloads. */
export function coerceCashModelParams(raw: unknown): CashModelParams | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.horizon !== "number" || !Number.isFinite(p.horizon)) return null;
  const base = defaultCashModelParams();
  const opening = resolveOpeningBalanceOverride(
    p as unknown as CashModelParams
  );
  return {
    horizon: Math.trunc(p.horizon),
    selectedScenarioId:
      typeof p.selectedScenarioId === "string" && p.selectedScenarioId.trim()
        ? p.selectedScenarioId
        : base.selectedScenarioId,
    bucketMap:
      p.bucketMap && typeof p.bucketMap === "object" && !Array.isArray(p.bucketMap)
        ? (p.bucketMap as CashModelParams["bucketMap"])
        : {},
    driverSpec:
      p.driverSpec && typeof p.driverSpec === "object" && !Array.isArray(p.driverSpec)
        ? (p.driverSpec as CashModelParams["driverSpec"])
        : {},
    excludedMonths: Array.isArray(p.excludedMonths)
      ? (p.excludedMonths as CashModelParams["excludedMonths"])
      : [],
    openingBalance: opening,
  };
}

/**
 * Use provided scenarios when non-empty; otherwise synthesize base+downside from
 * params.minCashThreshold. Never invents a Floor — returns null if missing.
 */
export function coerceCashModelScenarios(
  rawParams: unknown,
  scenarios: unknown
): CashModelScenario[] | null {
  if (isCashModelScenarioArray(scenarios) && scenarios.length > 0) {
    return scenarios;
  }
  const floor =
    rawParams &&
    typeof rawParams === "object" &&
    typeof (rawParams as { minCashThreshold?: unknown }).minCashThreshold ===
      "number"
      ? (rawParams as { minCashThreshold: number }).minCashThreshold
      : null;
  if (floor == null || !Number.isFinite(floor)) return null;
  return defaultCashModelScenarios(floor);
}

export const cashModelKind: ModelKindDef<
  CashModelStudioParams,
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
    {
      key: "accountId",
      label: "Account",
      kind: "select",
      options: [{ value: "__all__", label: "All accounts" }],
    },
    { key: "openingBalance", label: "Opening balance", kind: "money", seed: true },
    { key: "minCashThreshold", label: "Floor", kind: "money" },
    { key: "horizon", label: "Horizon", kind: "months", min: 1, max: 36 },
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
    const coercedParams = coerceCashModelParams(params);
    const coercedScenarios = coerceCashModelScenarios(params, scenarios);
    if (!coercedParams || !coercedScenarios) return null;
    const composed = composeCashModelResponse(
      loaded,
      coercedParams,
      coercedScenarios
    );
    return {
      composed: {
        ...composed,
        derived_snapshot: {
          ...composed.derived_snapshot,
          openingBalance: loaded.openingBalanceRaw,
        },
      },
      openingBalanceSource: loaded.openingBalanceSource,
      coercedParams,
      coercedScenarios,
    };
  },
  toSnapshot(row, inputs, params, scenarios, result) {
    const coercedParams =
      result.coercedParams ?? coerceCashModelParams(params);
    const coercedScenarios =
      result.coercedScenarios ?? coerceCashModelScenarios(params, scenarios);
    if (!coercedParams || !coercedScenarios) {
      throw new Error("cash_model toSnapshot missing coerced params/scenarios");
    }
    const { composed, openingBalanceSource } = result;
    const conf = cashModelKind.confidence(inputs, params, result);
    const floor =
      coercedScenarios.find((s) => s.id === coercedParams.selectedScenarioId)
        ?.minCashThreshold ??
      coercedScenarios[0]?.minCashThreshold ??
      null;
    const opening =
      inputs.cashModel?.openingBalanceRaw ?? coercedParams.openingBalance ?? null;

    const base = placedStudyFromCashModelCompute({
      studyId: String(row.id ?? "preview"),
      name: String(row.name ?? "Runway"),
      asOf: composed.asOf,
      openingBalanceRaw: inputs.cashModel?.openingBalanceRaw ?? null,
      openingBalanceSource,
      timeline: composed.timeline,
      summaries: composed.summaries,
      params: coercedParams,
      scenarios: coercedScenarios,
      derived: composed.derived_snapshot,
    });

    const assumptions: string[] = [];
    if (opening != null && Number.isFinite(opening)) {
      assumptions.push(`opening ${opening}`);
    }
    if (floor != null) assumptions.push(`floor ${floor}`);
    assumptions.push(`horizon ${coercedParams.horizon} mo`);

    return scrubPlacedStudySnapshot(
      normalizePlacedStudy({
        ...base,
        assumptions,
        method_note: CASH_MODEL_EXPLAIN,
        confidence: {
          grade: conf.grade,
          note: conf.reasons[0],
        },
      })
    );
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
