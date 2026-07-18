"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TreasuryCashflowDecomposition } from "@/components/operator/treasury/TreasuryCashflowDecomposition";
import { formatSuMoney, formatTreasuryMoney } from "@/lib/treasury/format";
import { periodEnd, periodLabel } from "@/lib/treasury/period-bounds";
import { aggregateByLabel, topContributors } from "@/lib/treasury/period-decomposition";
import type { SummaryBucket, TreasurySummaryRow, TreasuryTransactionRow } from "@/lib/treasury/types";

/** Stage 8b-4 — Analyzer month drill (series-scoped to the bar). */
export type AnalyzerMonthDrill = {
  accountId: string;
  label?: string | null;
  monthYm: string;
  /** Bar dollar — modal outflow must match. */
  expectedOutflow: number;
  excluded: boolean;
  initialReason?: string;
  onKeep: () => void;
  onExclude: (reason: string) => void;
};

type Props = {
  open: boolean;
  clientUserId: string;
  bucket: SummaryBucket;
  row: TreasurySummaryRow;
  onClose: () => void;
  onOpenInTransactions?: (bucket: SummaryBucket, periodStart: string) => void;
  /** When set, fetch the Analyzer series (not all transactions) + Keep/Exclude footer. */
  analyzer?: AnalyzerMonthDrill | null;
};

export function TreasuryPeriodDrillModal({
  open,
  clientUserId,
  bucket,
  row,
  onClose,
  onOpenInTransactions,
  analyzer = null,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [transactions, setTransactions] = useState<TreasuryTransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [seriesOutflow, setSeriesOutflow] = useState<number | null>(null);
  const [excludeReason, setExcludeReason] = useState("");

  const from = row.period_start;
  const to = periodEnd(bucket, row.period_start);
  const titleLabel = analyzer
    ? `Month ${analyzer.monthYm}`
    : periodLabel(bucket, row.period_start);

  const loadSummary = useCallback(
    async (append = false, pageCursor?: string | null) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ from, to, limit: "100" });
      if (append && pageCursor) params.set("cursor", pageCursor);
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions?${params}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          transactions: TreasuryTransactionRow[];
          nextCursor: string | null;
        };
        setTransactions((prev) =>
          append ? [...prev, ...data.transactions] : data.transactions
        );
        setCursor(data.nextCursor);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to load transactions");
        if (!append) setTransactions([]);
      }
      setLoading(false);
    },
    [clientUserId, from, to]
  );

  const loadAnalyzer = useCallback(async () => {
    if (!analyzer) return;
    setLoading(true);
    setError(null);
    setCursor(null);
    const params = new URLSearchParams({
      account_id: analyzer.accountId,
      month: analyzer.monthYm,
    });
    if (analyzer.label) params.set("label", analyzer.label);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/spend-plan/month-series?${params}`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        transactions: TreasuryTransactionRow[];
        outflowTotal: number;
      };
      setTransactions(data.transactions);
      setSeriesOutflow(data.outflowTotal);
      const delta = Math.abs(data.outflowTotal - analyzer.expectedOutflow);
      if (delta > 0.02) {
        setError(
          `Series total $${data.outflowTotal.toLocaleString()} does not match bar $${analyzer.expectedOutflow.toLocaleString()} (Δ$${delta.toFixed(2)}).`
        );
      }
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load month series");
      setTransactions([]);
      setSeriesOutflow(null);
    }
    setLoading(false);
  }, [analyzer, clientUserId]);

  useEffect(() => {
    if (!open) return;
    setExcludeReason(analyzer?.initialReason ?? "");
    if (analyzer) {
      void loadAnalyzer();
    } else {
      setSeriesOutflow(null);
      setCursor(null);
      void loadSummary(false, null);
    }
  }, [open, analyzer, loadAnalyzer, loadSummary]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const decomposition = useMemo(
    () => aggregateByLabel(transactions),
    [transactions]
  );
  const contributors = useMemo(
    () => topContributors(transactions, 5),
    [transactions]
  );

  const displayOut =
    analyzer && seriesOutflow != null ? seriesOutflow : row.outflow;
  const displayCount = analyzer ? transactions.length : row.count;
  const currency = row.iso_currency_code ?? "USD";

  if (!open) return null;

  return (
    <div
      className="tx-drill-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="tx-drill-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-drill-title"
      >
        <header className="tx-drill-head">
          <div>
            <p className="text-xs uppercase tracking-wide text-codex-muted">
              {analyzer ? "Analyzer sample" : "Period"}
            </p>
            <h2 id="tx-drill-title" className="font-head text-lg">
              {titleLabel}
            </h2>
            {analyzer?.label ? (
              <p className="text-xs text-codex-muted mt-1">
                Series · {analyzer.label} · outflows only
              </p>
            ) : analyzer ? (
              <p className="text-xs text-codex-muted mt-1">
                Series · account outflows only
              </p>
            ) : null}
          </div>
          <button type="button" className="btn btn-secondary text-xs" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="tx-drill-stats">
          {!analyzer ? (
            <div>
              <span className="text-xs text-codex-muted">In</span>
              <p className="tabular-nums font-medium">
                {formatTreasuryMoney(row.inflow, currency)}
              </p>
            </div>
          ) : null}
          <div>
            <span className="text-xs text-codex-muted">Out</span>
            <p className="tabular-nums font-medium">
              {formatTreasuryMoney(displayOut, currency)}
            </p>
          </div>
          {!analyzer ? (
            <div>
              <span className="text-xs text-codex-muted">Net</span>
              <p className="tabular-nums font-medium">
                {formatTreasuryMoney(row.net, currency)}
              </p>
            </div>
          ) : (
            <div>
              <span className="text-xs text-codex-muted">Bar</span>
              <p className="tabular-nums font-medium">
                {formatTreasuryMoney(analyzer.expectedOutflow, currency)}
              </p>
            </div>
          )}
          <div>
            <span className="text-xs text-codex-muted">Count</span>
            <p className="tabular-nums font-medium">{displayCount}</p>
          </div>
        </div>

        {error ? (
          <p className="panel-note text-cinnabar mb-3" role="alert">
            {error}
          </p>
        ) : null}

        {loading && transactions.length === 0 ? (
          <p className="text-sm text-codex-muted">Loading transactions…</p>
        ) : transactions.length > 0 ? (
          <>
            {!analyzer ? (
              <TreasuryCashflowDecomposition
                decomposition={decomposition}
                contributors={contributors}
                currency={currency}
                netLabel="Net for the period"
              />
            ) : null}

            <p className="text-xs font-mono uppercase tracking-wide text-codex-muted mb-2 mt-4">
              Transactions
            </p>
            <ul className="tx-drill-list">
              {transactions.map((tx) => (
                <li key={tx.id} className="tx-drill-row">
                  <span className="tx-drill-date">{tx.posted_date ?? "—"}</span>
                  <span className="tx-drill-payee">
                    {tx.merchant_name ?? tx.normalized_merchant ?? tx.raw_name ?? "—"}
                  </span>
                  <span className="tx-drill-label">{tx.label ?? "—"}</span>
                  <span
                    className={`tx-drill-amt rtx-amt tabular-nums ${tx.direction === "in" ? "in" : "out"}`}
                  >
                    {formatSuMoney(Number(tx.amount), tx.direction)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : !error ? (
          <p className="text-sm text-codex-muted">No transactions in this period.</p>
        ) : null}

        {!analyzer && cursor ? (
          <button
            type="button"
            className="btn btn-secondary text-xs mt-3"
            disabled={loading}
            onClick={() => void loadSummary(true, cursor)}
          >
            Load more
          </button>
        ) : null}

        <footer className="tx-drill-foot">
          {analyzer ? (
            <div className="flex flex-col gap-3 w-full">
              <label className="text-xs text-codex-muted flex flex-col gap-1">
                Exclude reason
                <input
                  className="req-input"
                  value={excludeReason}
                  onChange={(e) => setExcludeReason(e.target.value)}
                  placeholder="e.g. double pay?"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {analyzer.excluded ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      analyzer.onKeep();
                      onClose();
                    }}
                  >
                    Keep
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      analyzer.onExclude(excludeReason.trim());
                      onClose();
                    }}
                  >
                    Exclude
                  </button>
                )}
                <button type="button" className="btn ghost sm" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          ) : onOpenInTransactions ? (
            <button
              type="button"
              className="text-sm font-medium text-brand-2 underline"
              onClick={() => {
                onOpenInTransactions(bucket, row.period_start);
                onClose();
              }}
            >
              Open in Transactions →
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
