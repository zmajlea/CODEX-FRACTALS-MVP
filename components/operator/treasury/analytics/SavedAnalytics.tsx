"use client";

import { useMemo } from "react";
import { CashModelStudyView } from "@/components/operator/treasury/cash-model/CashModelStudyView";
import { StudyList } from "@/components/operator/treasury/analytics/StudyList";
import {
  driftLine,
  useStudyPersistence,
} from "@/components/operator/treasury/analytics/useStudyPersistence";
import { isKnownStudyType } from "@/components/operator/treasury/analytics/study-registry";
import { TreasurySpendPlanPanel } from "@/components/operator/treasury/TreasurySpendPlanPanel";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { AssistantProposals } from "@/components/operator/treasury/analytics/AssistantProposals";
import { MetricsList } from "@/components/operator/treasury/analytics/MetricsList";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { CashModelStudyRow } from "@/lib/treasury/studies";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  accountsData: TreasuryAccountsResponse | null;
  accounts: { id: string; name: string }[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
  initialStudyId?: string;
  clientName?: string;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

/**
 * Spec 65-R Part A — Saved Analytics section (dissolves former AnalyticsShell).
 * StudyList is the main surface; selecting a known type opens its Panel in place.
 * Unknown study.type renders inert — never through another type's editor.
 */
export function SavedAnalytics({
  clientUserId,
  accountsData,
  accounts,
  accountId,
  onAccountIdChange,
  initialStudyId,
  clientName,
  onPick,
}: Props) {
  const persistence = useStudyPersistence({
    clientUserId,
    accountId,
    onAccountIdChange,
    initialStudyId,
  });

  const accountNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) map[a.id] = a.name;
    return map;
  }, [accounts]);

  const studyPickable = useMemo((): Pickable | null => {
    if (!persistence.studyId) return null;
    return {
      kind: "study",
      ref: persistence.studyId,
      label: persistence.studyName.trim() || "Untitled study",
      sublabel: "study",
    };
  }, [persistence.studyId, persistence.studyName]);

  const saved = persistence.savedRow;
  const known = saved != null && isKnownStudyType(saved.type);
  const activeType = known ? saved!.type : null;

  return (
    <div className="saved-analytics space-y-4">
      <AssistantProposals clientUserId={clientUserId} />
      <MetricsList clientUserId={clientUserId} />
      <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
      <aside
        className="panel p-3"
        style={{ border: "1px solid var(--line)", minHeight: 320 }}
      >
        <StudyList
          studies={persistence.studies}
          activeId={persistence.studyId}
          onSelect={persistence.selectStudy}
          loading={persistence.listLoading}
          accountNameById={accountNameById}
        />
      </aside>

      <div className="space-y-4">
        {!saved ? (
          <div
            className="panel p-6"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title">Select a saved study</p>
            <p className="treasury-meta text-sm mt-2">
              Cards on the left open in place. Create new work under Cash Model
              or Spend plan.
            </p>
          </div>
        ) : !known ? (
          <div
            className="panel p-6"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title">{saved.name}</p>
            <p className="treasury-meta text-sm mt-2">
              This study type is not supported in the current Analytics build.
              It cannot be opened in an editor.
            </p>
          </div>
        ) : (
          <>
            <div
              className="panel p-3 flex flex-wrap items-end gap-3"
              style={{ border: "1px solid var(--line)" }}
            >
              <label className="flex flex-col gap-1 text-sm flex-1 min-w-[12rem]">
                <span className="treasury-meta">Study name</span>
                <input
                  className="field-input"
                  value={persistence.studyName}
                  onChange={(e) => persistence.setStudyName(e.target.value)}
                  disabled={activeType === "cash_model"}
                />
              </label>
              {activeType === "spend_plan" ? (
                <>
                  <button
                    type="button"
                    className="chip"
                    disabled={
                      persistence.busy || !persistence.modelState.currentSnapshot
                    }
                    onClick={() => void persistence.handleSave()}
                  >
                    {persistence.busy ? "Saving…" : "Save"}
                  </button>
                  {persistence.studyId ? (
                    <button
                      type="button"
                      className="chip"
                      disabled={persistence.busy}
                      onClick={() => void persistence.handleDelete()}
                    >
                      Delete
                    </button>
                  ) : null}
                </>
              ) : null}
              {studyPickable ? (
                <PickButton
                  variant="header"
                  pickable={studyPickable}
                  onPick={async (kind, pickable) => {
                    await onPick?.(kind, pickable);
                  }}
                />
              ) : null}
              {persistence.dirty ? (
                <span className="chip prov-assumed">unsaved</span>
              ) : persistence.studyId ? (
                <span className="chip prov-pulled">saved</span>
              ) : null}
            </div>

            {persistence.drift && persistence.drift.length > 0 ? (
              <div
                className="panel p-3 space-y-2"
                style={{ border: "1px solid var(--pulse-amber, #EBC06D)" }}
              >
                <p className="sec-title">Data moved since this study was saved</p>
                <ul className="text-sm space-y-1">
                  {persistence.drift.map((d) => (
                    <li key={d.field} className="treasury-meta">
                      {driftLine(d)}
                    </li>
                  ))}
                </ul>
                <p className="treasury-meta-fine">
                  Keep saved applies adjusted overrides (not pulled) — the kept
                  figure diverges from what the data says now.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="chip prov-adjusted"
                    onClick={persistence.handleKeepSaved}
                  >
                    Keep saved
                  </button>
                  <button
                    type="button"
                    className="chip prov-pulled"
                    onClick={persistence.handleUseCurrent}
                  >
                    Use current
                  </button>
                </div>
              </div>
            ) : null}

            {persistence.message ? (
              <p className="treasury-meta-fine">{persistence.message}</p>
            ) : null}

            {activeType === "cash_model" && saved.type === "cash_model" ? (
              <CashModelStudyView
                clientUserId={clientUserId}
                accounts={accounts}
                accountId={accountId}
                onAccountIdChange={onAccountIdChange}
                study={saved as CashModelStudyRow}
              />
            ) : activeType === "spend_plan" ? (
              <TreasurySpendPlanPanel
                clientUserId={clientUserId}
                accountsData={accountsData}
                accountId={accountId}
                onAccountIdChange={onAccountIdChange}
                modelState={persistence.modelState}
                studyId={persistence.studyId}
                embedded
                clientName={clientName}
                onPick={onPick}
              />
            ) : null}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
