"use client";

import { useCallback, useEffect, useState } from "react";
import { AnalyticsShell } from "@/components/operator/treasury/analytics/AnalyticsShell";
import { TreasurySummaryPanel } from "@/components/operator/treasury/TreasurySummaryPanel";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  SummaryBucket,
  TreasuryAccountsResponse,
} from "@/lib/treasury/types";

export type AnalyticsView = "forecast" | "analyzer";

type Props = {
  clientUserId: string;
  demo?: boolean;
  hasSyncedData?: boolean;
  accountsData: TreasuryAccountsResponse | null;
  initialView?: AnalyticsView;
  initialStudyId?: string;
  onSelectPeriod?: (bucket: SummaryBucket, periodStart: string) => void;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  onViewChange?: (view: AnalyticsView) => void;
};

export function TreasuryAnalyticsPanel({
  clientUserId,
  demo = false,
  hasSyncedData = true,
  accountsData,
  initialView = "forecast",
  initialStudyId,
  onSelectPeriod,
  onPick,
  onViewChange,
}: Props) {
  const [view, setView] = useState<AnalyticsView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

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
      </div>
      <p className="span-line">
        Two engines, one place. Forecast projects how cash runs; Analyzer tests
        whether the reserve is enough. Each number states where it came from.
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
          id="t-forecast"
          aria-selected={view === "forecast"}
          aria-controls="p-forecast"
          onClick={() => showView("forecast")}
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
            <circle cx="12" cy="12" r="8.5" />
            <path d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z" />
          </svg>
          Forecast
        </button>
        <button
          type="button"
          role="tab"
          id="t-analyzer"
          aria-selected={view === "analyzer"}
          aria-controls="p-analyzer"
          onClick={() => showView("analyzer")}
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
          Analyzer
        </button>
      </div>

      <section
        className={`tabpanel${view === "forecast" ? " on" : ""}`}
        id="p-forecast"
        role="tabpanel"
        aria-labelledby="t-forecast"
      >
        <TreasurySummaryPanel
          clientUserId={clientUserId}
          hasSyncedData={hasSyncedData}
          embedded
          onSelectPeriod={onSelectPeriod}
          onPick={onPick}
        />
      </section>

      <section
        className={`tabpanel${view === "analyzer" ? " on" : ""}`}
        id="p-analyzer"
        role="tabpanel"
        aria-labelledby="t-analyzer"
      >
        <AnalyticsShell
          clientUserId={clientUserId}
          accountsData={accountsData}
          initialStudyId={initialStudyId}
          embedded
          onPick={onPick}
        />
      </section>
    </>
  );
}
