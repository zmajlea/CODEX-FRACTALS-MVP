"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TreasurySpendPlanPanel } from "@/components/operator/treasury/TreasurySpendPlanPanel";
import { CashModelStudyView } from "@/components/operator/treasury/cash-model/CashModelStudyView";
import { StudyList } from "@/components/operator/treasury/analytics/StudyList";
import { useSpendPlanModel } from "@/components/operator/treasury/spend-plan/useSpendPlanModel";
import { PickButton } from "@/components/operator/treasury/PickButton";
import {
  defaultStudyParams,
  diffDerivedSnapshot,
  emptyOverrides,
  overridesFromKeepSaved,
  type DriftEntry,
  type TreasuryStudyRow,
} from "@/lib/treasury/studies";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  accountsData: TreasuryAccountsResponse | null;
  /** Spec 50 — controlled account scope (shared with Forecast). */
  accounts: { id: string; name: string }[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
  initialStudyId?: string;
  /** Spec 46 Stage 7 — inside Analytics Analyzer subtab. */
  embedded?: boolean;
  clientName?: string;
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function driftLine(d: DriftEntry): string {
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

export function AnalyticsShell({
  clientUserId,
  accountsData,
  accounts,
  accountId,
  onAccountIdChange,
  initialStudyId,
  embedded = false,
  clientName,
  onPick,
}: Props) {
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

  // Spec 65 — idempotent primary cash_model row per account (navigation-safe)
  useEffect(() => {
    if (!accountId) return;
    void (async () => {
      await fetch(
        `/api/operator/treasury/clients/${clientUserId}/studies/ensure-primary-cash-model`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        }
      );
      await refreshList();
    })();
  }, [accountId, clientUserId, refreshList]);

  // Deep-link / initial study
  useEffect(() => {
    if (!initialStudyId || studies.length === 0) return;
    const row = studies.find((s) => s.id === initialStudyId);
    if (row) setPendingLoad(row);
  }, [initialStudyId, studies]);

  // Apply pending load once history for that account is ready (spend_plan only)
  useEffect(() => {
    if (!pendingLoad || pendingLoad.type !== "spend_plan") return;
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
      // If data drifted, start on current pulled until Keep saved (→ adjusted).
      // If no drift, restore any prior adjusted overrides from the saved row.
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
    if (!savedRow || savedRow.type !== "spend_plan" || !modelState.inputs) {
      return studyId == null;
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

  const handleNew = () => {
    setStudyId(null);
    setSavedRow(null);
    setDrift(null);
    setStudyName("Untitled spend plan");
    modelState.setOverrides(emptyOverrides());
    modelState.setExcludedMonths([]);
    modelState.resync();
    setMessage(null);
  };

  const handleSelect = (id: string) => {
    const row = studies.find((s) => s.id === id);
    if (!row) return;
    if (row.type === "cash_model") {
      if (accountId !== row.scope.accountId) {
        onAccountIdChange(row.scope.accountId);
      }
      setStudyId(row.id);
      setStudyName(row.name);
      setSavedRow(row);
      setPendingLoad(null);
      setDrift(null);
      setMessage(null);
      return;
    }
    setPendingLoad(row);
  };

  const handleKeepSaved = () => {
    if (!savedRow || savedRow.type !== "spend_plan" || !drift?.length) return;
    // Kept-stale baselines are adjusted — same path as explicit override.
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
  };

  const handleUseCurrent = () => {
    modelState.setOverrides(emptyOverrides());
    setDrift(null);
    setMessage("Using current pulled baselines.");
  };

  const handleSave = async () => {
    if (savedRow?.type === "cash_model") {
      return;
    }
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

    // Freeze what data says NOW (pulled snapshot), not the adjusted view.
    const derived_snapshot = modelState.currentSnapshot;

    setBusy(true);
    try {
      if (studyId) {
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
  };

  const handleDelete = async () => {
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
      handleNew();
      await refreshList();
      setMessage("Study deleted.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  async function addPickableToDraft(draftKind: DraftKind, pickable: Pickable) {
    await onPick?.(draftKind, pickable);
  }

  const studyPickable = useMemo((): Pickable | null => {
    if (!studyId) return null;
    return {
      kind: "study",
      ref: studyId,
      label: studyName.trim() || "Untitled spend plan",
      sublabel: "study",
    };
  }, [studyId, studyName]);

  const activeStudyType = savedRow?.type ?? "spend_plan";

  return (
    <div className="analytics-shell grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside
        className="panel p-3"
        style={{ border: "1px solid var(--line)", minHeight: 320 }}
      >
        <StudyList
          studies={studies}
          activeId={studyId}
          onSelect={handleSelect}
          onNew={handleNew}
          loading={listLoading}
        />
      </aside>

      <div className="space-y-4">
        <div
          className="panel p-3 flex flex-wrap items-end gap-3"
          style={{ border: "1px solid var(--line)" }}
        >
          <label className="flex flex-col gap-1 text-sm flex-1 min-w-[12rem]">
            <span className="treasury-meta">Study name</span>
            <input
              className="field-input"
              value={studyName}
              onChange={(e) => setStudyName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="chip"
            disabled={busy || activeStudyType === "cash_model" || !modelState.currentSnapshot}
            onClick={() => void handleSave()}
          >
            {busy ? "Saving…" : studyId ? "Save" : "Save as study"}
          </button>
          {studyId && activeStudyType !== "cash_model" ? (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              Delete
            </button>
          ) : null}
          {studyPickable ? (
            <PickButton
              variant="header"
              pickable={studyPickable}
              onPick={addPickableToDraft}
            />
          ) : null}
          {dirty ? (
            <span className="chip prov-assumed">unsaved</span>
          ) : studyId ? (
            <span className="chip prov-pulled">saved</span>
          ) : null}
        </div>

        {drift && drift.length > 0 ? (
          <div
            className="panel p-3 space-y-2"
            style={{ border: "1px solid var(--pulse-amber, #EBC06D)" }}
          >
            <p className="sec-title">Data moved since this study was saved</p>
            <ul className="text-sm space-y-1">
              {drift.map((d) => (
                <li key={d.field} className="treasury-meta">
                  {driftLine(d)}
                </li>
              ))}
            </ul>
            <p className="treasury-meta-fine">
              Keep saved applies adjusted overrides (not pulled) — the kept figure
              diverges from what the data says now.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="chip prov-adjusted" onClick={handleKeepSaved}>
                Keep saved
              </button>
              <button type="button" className="chip prov-pulled" onClick={handleUseCurrent}>
                Use current
              </button>
            </div>
          </div>
        ) : null}

        {message ? (
          <p className="treasury-meta-fine">{message}</p>
        ) : null}

        {activeStudyType === "cash_model" && savedRow?.type === "cash_model" ? (
          <CashModelStudyView
            clientUserId={clientUserId}
            accounts={accounts}
            accountId={accountId}
            onAccountIdChange={onAccountIdChange}
            study={savedRow}
          />
        ) : (
          <TreasurySpendPlanPanel
            clientUserId={clientUserId}
            accountsData={accountsData}
            accountId={accountId}
            onAccountIdChange={onAccountIdChange}
            modelState={modelState}
            studyId={studyId}
            embedded={embedded}
            clientName={clientName}
            onPick={onPick}
          />
        )}
      </div>
    </div>
  );
}
