"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  composeCashModelResponse,
  type CashModelComposedResponse,
  type CashModelLoadedInputs,
} from "@/lib/treasury/cash-model-compose";
import type {
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import type { CashModelStudyRow } from "@/lib/treasury/studies";

export type CashModelApiResponse = CashModelComposedResponse;

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
  const [inputs, setInputs] = useState<CashModelLoadedInputs | null>(null);
  const [loadingStudy, setLoadingStudy] = useState(!boundStudy);
  const [loadingInputs, setLoadingInputs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (boundStudy) {
      setStudy(boundStudy);
      setParams(boundStudy.params);
      setScenarios(boundStudy.scenarios);
      setLoadingStudy(false);
      return;
    }
    if (!accountId) {
      setStudy(null);
      setParams(null);
      setScenarios(null);
      setLoadingStudy(false);
      return;
    }

    let cancelled = false;
    setLoadingStudy(true);
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
        if (!cancelled) setLoadingStudy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientUserId, accountId, boundStudy, reloadToken]);

  useEffect(() => {
    if (!accountId) {
      setInputs(null);
      return;
    }

    let cancelled = false;
    setLoadingInputs(true);
    setError(null);

    void (async () => {
      try {
        const qs = new URLSearchParams({ account_id: accountId });
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/cash-model?${qs}`
        );
        const json = (await res.json()) as CashModelLoadedInputs & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load cash model inputs");
        if (!cancelled) setInputs(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
          setInputs(null);
        }
      } finally {
        if (!cancelled) setLoadingInputs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientUserId, accountId, reloadToken]);

  const deferredParams = useDeferredValue(params);
  const deferredScenarios = useDeferredValue(scenarios);

  const result = useMemo((): CashModelApiResponse | null => {
    if (!inputs || !deferredParams || !deferredScenarios) return null;
    return composeCashModelResponse(inputs, deferredParams, deferredScenarios);
  }, [inputs, deferredParams, deferredScenarios]);

  const computing =
    (params !== deferredParams || scenarios !== deferredScenarios) &&
    params != null &&
    scenarios != null;

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
    if (!study || !params || !scenarios) return;
    setSaving(true);
    setError(null);
    try {
      const computeRes = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/cash-model`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, params, scenarios }),
        }
      );
      const authoritative = (await computeRes.json()) as CashModelApiResponse & {
        error?: string;
      };
      if (!computeRes.ok) {
        throw new Error(authoritative.error ?? "Authoritative compute failed");
      }

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
            derived_snapshot: authoritative.derived_snapshot,
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
      setInputs((prev) =>
        prev && prev.accountId === accountId
          ? {
              ...prev,
              asOf: authoritative.asOf,
              openingBalance: authoritative.openingBalance,
              openingBalanceRaw: authoritative.derived_snapshot.openingBalance,
            }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [clientUserId, study, params, scenarios, accountId]);

  return {
    study,
    result,
    params,
    scenarios,
    loading: loadingStudy || loadingInputs,
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
