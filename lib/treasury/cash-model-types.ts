/**
 * Spec 65 — Cash Model study types (shared client/server, no DB imports).
 */

export const CASH_MODEL_BUCKET_KEYS = [
  "collections",
  "other_income",
  "payroll",
  "opex",
  "debt_service",
  "capex",
  "other_out",
  "uncategorized_in",
  "uncategorized_out",
] as const;

export type CashModelBucketKey = (typeof CASH_MODEL_BUCKET_KEYS)[number];

export type CashModelScenario = {
  id: string;
  name: string;
  factors: Record<CashModelBucketKey, number>;
  minCashThreshold: number;
  source: "assumed" | "user-provided";
};

export type CashModelDriverSpec = {
  mode: "trailing_mean" | "seasonal_mean" | "manual";
  manualValue?: number | null;
};

export type CashModelParams = {
  horizon: number;
  /** Selected is a pointer — not a third stored scenario. */
  selectedScenarioId: string;
  bucketMap: Record<string, CashModelBucketKey>;
  driverSpec: Partial<Record<CashModelBucketKey, CashModelDriverSpec>>;
  excludedMonths: Array<{ month: string; reason: string }>;
};

export type CashModelRunwayStatus = {
  level: "green" | "amber" | "red";
  label: string;
  selectedRunwayMonths: number | null;
  selectedBreachMonth: string | null;
  downsideBreachMonth: string | null;
  noBreachInHorizon: boolean;
};

export type CashModelDerivedSnapshot = {
  bucketBaselines: Partial<Record<CashModelBucketKey, number>>;
  coveragePct: number;
  bucketMap: Record<string, CashModelBucketKey>;
  openingBalance: number | null;
  asOf: string;
  historyMonthCount: number;
  /** Backward-walk history is approximate — always disclosed in UI. */
  historyDerived: boolean;
  /** Saved chip summary for portfolio triage — no category reload. */
  runwayStatus?: CashModelRunwayStatus;
};

function unitFactors(): Record<CashModelBucketKey, number> {
  const out = {} as Record<CashModelBucketKey, number>;
  for (const k of CASH_MODEL_BUCKET_KEYS) out[k] = 1;
  return out;
}

export function defaultCashModelScenarios(): CashModelScenario[] {
  const baseFactors = unitFactors();
  const downsideFactors = { ...baseFactors, collections: 0.9, payroll: 1.05, opex: 1.08 };
  return [
    {
      id: "base",
      name: "Base",
      factors: baseFactors,
      minCashThreshold: 500_000,
      source: "assumed",
    },
    {
      id: "downside",
      name: "Downside",
      factors: downsideFactors,
      minCashThreshold: 500_000,
      source: "assumed",
    },
  ];
}

export function defaultCashModelParams(): CashModelParams {
  return {
    horizon: 13,
    selectedScenarioId: "base",
    bucketMap: {},
    driverSpec: {},
    excludedMonths: [],
  };
}

export function emptyCashModelDerivedSnapshot(asOf?: string): CashModelDerivedSnapshot {
  return {
    bucketBaselines: {},
    coveragePct: 0,
    bucketMap: {},
    openingBalance: null,
    asOf: asOf ?? new Date().toISOString().slice(0, 10),
    historyMonthCount: 0,
    historyDerived: true,
  };
}

export function isCashModelParams(value: unknown): value is CashModelParams {
  if (!value || typeof value !== "object") return false;
  const p = value as CashModelParams;
  return (
    typeof p.horizon === "number" &&
    typeof p.selectedScenarioId === "string" &&
    typeof p.bucketMap === "object" &&
    Array.isArray(p.excludedMonths)
  );
}

export function isCashModelScenarioArray(value: unknown): value is CashModelScenario[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s) =>
        s &&
        typeof s === "object" &&
        typeof (s as CashModelScenario).id === "string" &&
        typeof (s as CashModelScenario).minCashThreshold === "number"
    )
  );
}

export function isCashModelDerivedSnapshot(
  value: unknown
): value is CashModelDerivedSnapshot {
  if (!value || typeof value !== "object") return false;
  const d = value as CashModelDerivedSnapshot;
  return typeof d.asOf === "string" && typeof d.historyMonthCount === "number";
}
