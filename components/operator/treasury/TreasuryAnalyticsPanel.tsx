"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalyticsShell } from "@/components/operator/treasury/analytics/AnalyticsShell";
import { TreasuryCashModelPanel } from "@/components/operator/treasury/TreasuryCashModelPanel";
import { useCashModel } from "@/components/operator/treasury/cash-model/useCashModel";
import { CashModelRunwayChip } from "@/components/operator/treasury/cash-model/CashModelRunwayChip";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  SummaryBucket,
  TreasuryAccountsResponse,
} from "@/lib/treasury/types";

/** Spec 65 Part I — Forecast retired; deep-links to forecast redirect to cash_model. */
export type AnalyticsView = "cash_model" | "studies";

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
        Cash model projects runway from labeled history; Studies holds saved
        scenarios and spend plans. Each number states where it came from.
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
          id="t-cash-model"
          aria-selected={view === "cash_model"}
          aria-controls="p-cash-model"
          onClick={() => showView("cash_model")}
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
            <path d="M4 19h16M6 19V9M11 19V5M16 19v-7" />
          </svg>
          Cash model
        </button>
        <button
          type="button"
          role="tab"
          id="t-studies"
          aria-selected={view === "studies"}
          aria-controls="p-studies"
          onClick={() => showView("studies")}
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
          Studies
        </button>
      </div>

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
        className={`tabpanel${view === "studies" ? " on" : ""}`}
        id="p-studies"
        role="tabpanel"
        aria-labelledby="t-studies"
      >
        <AnalyticsShell
          clientUserId={clientUserId}
          accountsData={accountsData}
          accounts={accounts}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          initialStudyId={initialStudyId}
          embedded
          clientName={clientName}
          onPick={onPick}
        />
      </section>
    </>
  );
}
