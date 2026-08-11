"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpendPlanModel } from "@/components/operator/treasury/spend-plan/useSpendPlanModel";
import {
  defaultStudyParams,
  diffDerivedSnapshot,
  emptyOverrides,
  overridesFromKeepSaved,
  type DriftEntry,
  type TreasuryStudyRow,
} from "@/lib/treasury/studies";
import { isKnownStudyType } from "@/components/operator/treasury/analytics/study-registry";

type Options = {
  clientUserId: string;
  accountId: string;
  onAccountIdChange: (id: string) => void;
  initialStudyId?: string;
};

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function driftLine(d: DriftEntry): string {
  if (d.field === "seasonalIndices") {
    const months = (d.affectedMonths ?? [])
      .map((m) => String(m).padStart(2, "0"))
      .join(", ");
    return `Seasonal indices changed (months ${months || "—"})`;
  }
  if (d.field === "l0") {
    return `L0 was $${fmtMoney(Number(d.saved))} when saved; now $${fmtMoney(Number(d.current))}`;
  }
  if (d.field === "buffer") {
    return `Buffer was ${d.saved == null ? "—" : `$${fmtMoney(Number(d.saved))}`}; now ${
      d.current == null ? "—" : `$${fmtMoney(Number(d.current))}`
    }`;
  }
  if (d.field === "ttmYoy") {
    const fmt = (v: unknown) =>
      v == null ? "unavailable" : `${(Number(v) * 100).toFixed(1)}%`;
    return `TTM YoY was ${fmt(d.saved)}; now ${fmt(d.current)}`;
  }
  if (d.field === "l0Window") {
    return `L0 window changed`;
  }
  return `${d.field}: saved ${String(d.saved)} → now ${String(d.current)}`;
}

/**
 * Spec 65-R — shared list / save / drift / pick for typed study panels.
 * Ensure-primary lives in useCashModel only (no duplicate POST here).
 */
export function useStudyPersistence({
  clientUserId,
  accountId,
  onAccountIdChange,
  initialStudyId,
}: Options) {
  const [studies, setStudies] = useState<TreasuryStudyRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [studyId, setStudyId] = useState<string | null>(null);
  const [studyName, setStudyName] = useState("Untitled spend plan");
  const [savedRow, setSavedRow] = useState<TreasuryStudyRow | null>(null);
  const [drift, setDrift] = useState<DriftEntry[] | null>(null);
  const [pendingLoad, setPendingLoad] = useState<TreasuryStudyRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const modelState = useSpendPlanModel(clientUserId, accountId);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/studies`
    );
    const json = (await res.json()) as {
      studies?: TreasuryStudyRow[];
      error?: string;
    };
    if (res.ok) setStudies(json.studies ?? []);
    setListLoading(false);
  }, [clientUserId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!initialStudyId || studies.length === 0) return;
    const row = studies.find((s) => s.id === initialStudyId);
    if (row) setPendingLoad(row);
  }, [initialStudyId, studies]);

  // Apply pending load once history for that account is ready (spend_plan only)
  useEffect(() => {
    if (!pendingLoad) return;
    if (!isKnownStudyType(pendingLoad.type)) {
      setStudyId(pendingLoad.id);
      setStudyName(pendingLoad.name);
      setSavedRow(pendingLoad);
      setPendingLoad(null);
      setDrift(null);
      setMessage(null);
      return;
    }
    if (pendingLoad.type === "cash_model") {
      if (accountId !== pendingLoad.scope.accountId) {
        onAccountIdChange(pendingLoad.scope.accountId);
        return;
      }
      setStudyId(pendingLoad.id);
      setStudyName(pendingLoad.name);
      setSavedRow(pendingLoad);
      setPendingLoad(null);
      setDrift(null);
      setMessage(null);
      return;
    }
    if (pendingLoad.type !== "spend_plan") return;
    const row = pendingLoad;
    if (accountId !== row.scope.accountId) {
      onAccountIdChange(row.scope.accountId);
      return;
    }
    if (!modelState.history || modelState.loading) return;

    const current = modelState.currentSnapshot;
    const d =
      current != null
        ? diffDerivedSnapshot(row.derived_snapshot, current)
        : [];

    modelState.applySeed({
      accountId: row.scope.accountId,
      inputs: {
        base: row.params.base,
        step: row.params.step,
        stepEveryMonths: row.params.stepEveryMonths,
        horizon: row.params.horizon,
        startMonth: row.params.startMonth,
        backtestStartMonth: (row.params.backtest.startMonth ?? "").slice(0, 7),
        backtestMonths: row.params.backtest.months,
        bufferAdjustment: row.params.bufferAdjustment,
      },
      overrides:
        d.length > 0 ? emptyOverrides() : row.params.overrides ?? emptyOverrides(),
      scenarios: row.scenarios,
      excludedMonths: row.params.excludedMonths ?? [],
    });

    setStudyId(row.id);
    setStudyName(row.name);
    setSavedRow(row);
    setDrift(d.length > 0 ? d : null);
    setPendingLoad(null);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingLoad,
    accountId,
    onAccountIdChange,
    modelState.history,
    modelState.loading,
    modelState.currentSnapshot,
  ]);

  const dirty = useMemo(() => {
    if (savedRow?.type === "cash_model") return false;
    if (!isKnownStudyType(savedRow?.type ?? "") && savedRow) return false;
    if (!savedRow || savedRow.type !== "spend_plan" || !modelState.inputs) {
      return studyId == null && savedRow == null;
    }
    const p = savedRow.params;
    const i = modelState.inputs;
    return (
      studyName !== savedRow.name ||
      i.base !== p.base ||
      i.step !== p.step ||
      i.stepEveryMonths !== p.stepEveryMonths ||
      i.horizon !== p.horizon ||
      i.startMonth !== p.startMonth ||
      i.bufferAdjustment !== p.bufferAdjustment ||
      i.backtestStartMonth !== (p.backtest.startMonth ?? "").slice(0, 7) ||
      accountId !== savedRow.scope.accountId ||
      JSON.stringify(modelState.overrides) !== JSON.stringify(p.overrides) ||
      JSON.stringify(modelState.scenarios) !== JSON.stringify(savedRow.scenarios) ||
      JSON.stringify(modelState.excludedMonths) !==
        JSON.stringify(p.excludedMonths ?? [])
    );
  }, [
    savedRow,
    modelState.inputs,
    modelState.overrides,
    modelState.scenarios,
    modelState.excludedMonths,
    studyName,
    studyId,
    accountId,
  ]);

  const clearSelection = useCallback(() => {
    setStudyId(null);
    setSavedRow(null);
    setDrift(null);
    setStudyName("Untitled spend plan");
    modelState.setOverrides(emptyOverrides());
    modelState.setExcludedMonths([]);
    modelState.resync();
    setMessage(null);
  }, [modelState]);

  const selectStudy = useCallback(
    (id: string) => {
      const row = studies.find((s) => s.id === id);
      if (!row) return;
      setPendingLoad(row);
    },
    [studies]
  );

  const handleKeepSaved = useCallback(() => {
    if (!savedRow || savedRow.type !== "spend_plan" || !drift?.length) return;
    const next = overridesFromKeepSaved(
      savedRow.derived_snapshot,
      drift,
      modelState.overrides
    );
    modelState.setOverrides(next);
    setDrift(null);
    setMessage(
      "Kept saved baselines — chipped as adjusted (they diverge from current pulled data)."
    );
  }, [savedRow, drift, modelState]);

  const handleUseCurrent = useCallback(() => {
    modelState.setOverrides(emptyOverrides());
    setDrift(null);
    setMessage("Using current pulled baselines.");
  }, [modelState]);

  const handleSave = useCallback(async () => {
    if (savedRow?.type === "cash_model") return;
    if (!isKnownStudyType(savedRow?.type ?? "spend_plan")) return;
    if (!modelState.inputs || !modelState.currentSnapshot || !modelState.scenarios) {
      setMessage("Nothing to save yet — pick an account with history.");
      return;
    }
    if (!accountId) {
      setMessage("Select an account first.");
      return;
    }

    const btStart =
      modelState.inputs.backtestStartMonth
        ? `${modelState.inputs.backtestStartMonth}-01`
        : modelState.history?.completeMonths.slice(
            -(modelState.inputs.backtestMonths || 12)
          )[0] ?? `${modelState.inputs.startMonth}-01`;

    const params = {
      ...defaultStudyParams({
        base: modelState.inputs.base,
        startMonth: modelState.inputs.startMonth,
        backtestStart: btStart,
        backtestMonths: modelState.inputs.backtestMonths,
        excludedMonths: modelState.excludedMonths,
      }),
      base: modelState.inputs.base,
      step: modelState.inputs.step,
      stepEveryMonths: modelState.inputs.stepEveryMonths,
      horizon: modelState.inputs.horizon,
      startMonth: modelState.inputs.startMonth,
      bufferAdjustment: modelState.inputs.bufferAdjustment,
      overrides: modelState.overrides,
      excludedMonths: modelState.excludedMonths,
      backtest: {
        startMonth: btStart,
        months: modelState.inputs.backtestMonths,
        startingBuffer: 0,
      },
    };

    const derived_snapshot = modelState.currentSnapshot;

    setBusy(true);
    try {
      if (studyId && savedRow?.type === "spend_plan") {
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/studies/${studyId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: studyName.trim() || "Untitled spend plan",
              scope: { accountId, label: null },
              params,
              scenarios: modelState.scenarios,
              derived_snapshot,
            }),
          }
        );
        const json = (await res.json()) as {
          study?: TreasuryStudyRow;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Save failed");
        setSavedRow(json.study!);
        setStudyId(json.study!.id);
      } else {
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/studies`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: studyName.trim() || "Untitled spend plan",
              type: "spend_plan",
              scope: { accountId, label: null },
              params,
              scenarios: modelState.scenarios,
              derived_snapshot,
            }),
          }
        );
        const json = (await res.json()) as {
          study?: TreasuryStudyRow;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Save failed");
        setSavedRow(json.study!);
        setStudyId(json.study!.id);
      }
      setDrift(null);
      setMessage("Study saved — snapshot frozen.");
      await refreshList();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }, [
    savedRow,
    modelState,
    accountId,
    studyId,
    clientUserId,
    studyName,
    refreshList,
  ]);

  const handleDelete = useCallback(async () => {
    if (!studyId) return;
    if (!confirm("Delete this study?")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/studies/${studyId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Delete failed");
      }
      clearSelection();
      await refreshList();
      setMessage("Study deleted.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }, [studyId, clientUserId, clearSelection, refreshList]);

  return {
    studies,
    listLoading,
    studyId,
    studyName,
    setStudyName,
    savedRow,
    drift,
    busy,
    message,
    dirty,
    modelState,
    refreshList,
    selectStudy,
    clearSelection,
    handleKeepSaved,
    handleUseCurrent,
    handleSave,
    handleDelete,
  };
}

export type StudyPersistence = ReturnType<typeof useStudyPersistence>;
