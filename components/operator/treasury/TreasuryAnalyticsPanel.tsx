"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SavedAnalytics } from "@/components/operator/treasury/analytics/SavedAnalytics";
import { STUDY_REGISTRY } from "@/components/operator/treasury/analytics/study-registry";
import { TreasuryCashModelPanel } from "@/components/operator/treasury/TreasuryCashModelPanel";
import { TreasurySpendPlanPanel } from "@/components/operator/treasury/TreasurySpendPlanPanel";
import { useCashModel } from "@/components/operator/treasury/cash-model/useCashModel";
import { CashModelRunwayChip } from "@/components/operator/treasury/cash-model/CashModelRunwayChip";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  SummaryBucket,
  TreasuryAccountsResponse,
} from "@/lib/treasury/types";

/**
 * Spec 65-R Part A — three extensible sections:
 * Saved Analytics | Cash Model | Spend plan (registry-driven).
 * Legacy: "studies" | "analyzer" → "saved".
 */
export type AnalyticsView = "saved" | "cash_model" | "spend_plan";

export function normalizeAnalyticsView(raw: string | undefined): AnalyticsView {
  if (raw === "studies" || raw === "analyzer" || raw === "saved") return "saved";
  if (raw === "spend_plan" || raw === "spend-plan") return "spend_plan";
  if (raw === "cash_model" || raw === "forecast") return "cash_model";
  return "cash_model";
}

type Props = {
  clientUserId: string;
  demo?: boolean;
  hasSyncedData?: boolean;
  accountsData: TreasuryAccountsResponse | null;
  initialView?: AnalyticsView;
  initialStudyId?: string;
  clientName?: string;
  onSelectPeriod?: (bucket: SummaryBucket, periodStart: string) => void;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  onViewChange?: (view: AnalyticsView) => void;
};

export function TreasuryAnalyticsPanel({
  clientUserId,
  demo = false,
  accountsData,
  initialView = "cash_model",
  initialStudyId,
  clientName,
  onPick,
  onViewChange,
}: Props) {
  const [view, setView] = useState<AnalyticsView>(initialView);

  const accounts = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    for (const inst of accountsData?.institutions ?? []) {
      for (const a of inst.accounts) {
        list.push({ id: a.account_id, name: a.name ?? a.account_id });
      }
    }
    return list;
  }, [accountsData]);

  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (accounts.length === 0) {
      if (accountId) setAccountId("");
      return;
    }
    if (!accountId || !accounts.some((a) => a.id === accountId)) {
      setAccountId(accounts[0]!.id);
    }
  }, [accounts, accountId]);

  const cashModel = useCashModel(clientUserId, accountId);

  const showView = useCallback(
    (next: AnalyticsView) => {
      setView(next);
      onViewChange?.(next);
    },
    [onViewChange]
  );

  return (
    <>
      <div className="hubhead">
        <div>
          <div className="eyebrow">Treasury record</div>
          <h1 className="title">Analytics</h1>
        </div>
        {view === "cash_model" ? (
          <CashModelRunwayChip
            status={cashModel.runwayStatus}
            computing={cashModel.computing}
          />
        ) : null}
      </div>
      <p className="span-line">
        Saved Analytics loads any frozen study; Cash Model is the live runway
        workbench; Spend plan authors a spend plan. Each number states where it
        came from.
        {demo ? (
          <>
            {" "}
            <span className="mark illustrative">Illustrative</span>
          </>
        ) : null}
      </p>

      <div className="subtabs" role="tablist" aria-label="Analytics">
        <button
          type="button"
          role="tab"
          id="t-saved"
          aria-selected={view === "saved"}
          aria-controls="p-saved"
          onClick={() => showView("saved")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 6h16M4 12h10M4 18h7" />
          </svg>
          Saved Analytics
        </button>
        {STUDY_REGISTRY.map((entry) => (
          <button
            key={entry.view}
            type="button"
            role="tab"
            id={`t-${entry.view}`}
            aria-selected={view === entry.view}
            aria-controls={`p-${entry.view}`}
            onClick={() => showView(entry.view)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {entry.view === "cash_model" ? (
                <path d="M4 19h16M6 19V9M11 19V5M16 19v-7" />
              ) : (
                <path d="M12 3v18M5 10l7-7 7 7M5 14l7 7 7-7" />
              )}
            </svg>
            {entry.navLabel}
          </button>
        ))}
      </div>

      <section
        className={`tabpanel${view === "saved" ? " on" : ""}`}
        id="p-saved"
        role="tabpanel"
        aria-labelledby="t-saved"
      >
        <SavedAnalytics
          clientUserId={clientUserId}
          accountsData={accountsData}
          accounts={accounts}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          initialStudyId={initialStudyId}
          clientName={clientName}
          onPick={onPick}
        />
      </section>

      <section
        className={`tabpanel${view === "cash_model" ? " on" : ""}`}
        id="p-cash-model"
        role="tabpanel"
        aria-labelledby="t-cash-model"
      >
        <TreasuryCashModelPanel
          clientUserId={clientUserId}
          accounts={accounts}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          model={cashModel}
          clientName={clientName}
        />
      </section>

      <section
        className={`tabpanel${view === "spend_plan" ? " on" : ""}`}
        id="p-spend_plan"
        role="tabpanel"
        aria-labelledby="t-spend_plan"
      >
        <TreasurySpendPlanPanel
          clientUserId={clientUserId}
          accountsData={accountsData}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          embedded
          clientName={clientName}
          onPick={onPick}
        />
      </section>
    </>
  );
}
