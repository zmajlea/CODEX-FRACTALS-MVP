"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CashModelDerivedSnapshot,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import type {
  CashModelScenarioSummary,
  CashModelTimelineRow,
} from "@/lib/treasury/cash-model";
import type { CashModelStudyRow } from "@/lib/treasury/studies";

export type CashModelApiResponse = {
  accountId: string;
  asOf: string;
  openingBalance: number;
  timeline: CashModelTimelineRow[];
  summaries: CashModelScenarioSummary[];
  coveragePct: number;
  degradedToTotals: boolean;
  refused: boolean;
  refuseReason?: string;
  bucketBaselines: Partial<Record<string, number>>;
  completeMonths: string[];
  derived_snapshot: CashModelDerivedSnapshot;
};

export type CashModelModelState = {
  study: CashModelStudyRow | null;
  result: CashModelApiResponse | null;
  params: CashModelParams | null;
  scenarios: CashModelScenario[] | null;
  loading: boolean;
  computing: boolean;
  saving: boolean;
  error: string | null;
  setSelectedScenarioId: (id: string) => void;
  updateScenarioFactor: (
    scenarioId: string,
    bucket: keyof CashModelScenario["factors"],
    value: number
  ) => void;
  updateScenarioThreshold: (scenarioId: string, value: number) => void;
  saveStudy: () => Promise<void>;
  refresh: () => void;
};

export function useCashModel(
  clientUserId: string,
  accountId: string,
  boundStudy?: CashModelStudyRow | null
): CashModelModelState {
  const [study, setStudy] = useState<CashModelStudyRow | null>(boundStudy ?? null);
  const [params, setParams] = useState<CashModelParams | null>(
    boundStudy?.params ?? null
  );
  const [scenarios, setScenarios] = useState<CashModelScenario[] | null>(
    boundStudy?.scenarios ?? null
  );
  const [result, setResult] = useState<CashModelApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (boundStudy) {
      setStudy(boundStudy);
      setParams(boundStudy.params);
      setScenarios(boundStudy.scenarios);
      return;
    }
    if (!accountId) {
      setStudy(null);
      setParams(null);
      setScenarios(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const ensureRes = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/studies/ensure-primary-cash-model`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId }),
          }
        );
        const ensureJson = (await ensureRes.json()) as {
          study?: CashModelStudyRow;
          error?: string;
        };
        if (!ensureRes.ok || !ensureJson.study) {
          throw new Error(ensureJson.error ?? "Failed to load primary cash model");
        }
        if (cancelled) return;
        setStudy(ensureJson.study);
        setParams(ensureJson.study.params);
        setScenarios(ensureJson.study.scenarios);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientUserId, accountId, boundStudy, reloadToken]);

  const computeKey = useMemo(
    () =>
      params && scenarios
        ? JSON.stringify({ params, scenarios, accountId })
        : null,
    [params, scenarios, accountId]
  );

  useEffect(() => {
    if (!accountId || !params || !scenarios) return;

    let cancelled = false;
    setComputing(true);

    void (async () => {
      try {
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/cash-model`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId, params, scenarios }),
          }
        );
        const json = (await res.json()) as CashModelApiResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Compute failed");
        if (!cancelled) setResult(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Compute failed");
          setResult(null);
        }
      } finally {
        if (!cancelled) setComputing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientUserId, accountId, computeKey, params, scenarios]);

  const setSelectedScenarioId = useCallback((id: string) => {
    setParams((p) => (p ? { ...p, selectedScenarioId: id } : p));
  }, []);

  const updateScenarioFactor = useCallback(
    (
      scenarioId: string,
      bucket: keyof CashModelScenario["factors"],
      value: number
    ) => {
      setScenarios((prev) =>
        prev
          ? prev.map((s) =>
              s.id === scenarioId
                ? {
                    ...s,
                    factors: { ...s.factors, [bucket]: value },
                    source: "user-provided" as const,
                  }
                : s
            )
          : prev
      );
    },
    []
  );

  const updateScenarioThreshold = useCallback((scenarioId: string, value: number) => {
    setScenarios((prev) =>
      prev
        ? prev.map((s) =>
            s.id === scenarioId
              ? { ...s, minCashThreshold: value, source: "user-provided" as const }
              : s
          )
        : prev
    );
  }, []);

  const saveStudy = useCallback(async () => {
    if (!study || !params || !scenarios || !result) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/studies/${study.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: study.name,
            scope: study.scope,
            params,
            scenarios,
            derived_snapshot: result.derived_snapshot,
          }),
        }
      );
      const json = (await res.json()) as { study?: CashModelStudyRow; error?: string };
      if (!res.ok || !json.study || json.study.type !== "cash_model") {
        throw new Error(json.error ?? "Save failed");
      }
      setStudy(json.study);
      setParams(json.study.params);
      setScenarios(json.study.scenarios);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [clientUserId, study, params, scenarios, result]);

  return {
    study,
    result,
    params,
    scenarios,
    loading,
    computing,
    saving,
    error,
    setSelectedScenarioId,
    updateScenarioFactor,
    updateScenarioThreshold,
    saveStudy,
    refresh,
  };
}
