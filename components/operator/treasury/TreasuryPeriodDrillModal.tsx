"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TreasuryCashflowDecomposition } from "@/components/operator/treasury/TreasuryCashflowDecomposition";
import { formatSuMoney, formatTreasuryMoney } from "@/lib/treasury/format";
import { periodEnd, periodLabel } from "@/lib/treasury/period-bounds";
import { aggregateByLabel, topContributors } from "@/lib/treasury/period-decomposition";
import type { SummaryBucket, TreasurySummaryRow, TreasuryTransactionRow } from "@/lib/treasury/types";

type Props = {
  open: boolean;
  clientUserId: string;
  bucket: SummaryBucket;
  row: TreasurySummaryRow;
  onClose: () => void;
  onOpenInTransactions?: (bucket: SummaryBucket, periodStart: string) => void;
};

export function TreasuryPeriodDrillModal({
  open,
  clientUserId,
  bucket,
  row,
  onClose,
  onOpenInTransactions,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [transactions, setTransactions] = useState<TreasuryTransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const from = row.period_start;
  const to = periodEnd(bucket, row.period_start);
  const label = periodLabel(bucket, row.period_start);

  const load = useCallback(
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

  useEffect(() => {
    if (!open) return;
    setCursor(null);
    void load(false, null);
  }, [open, load]);

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
            <p className="text-xs uppercase tracking-wide text-codex-muted">Period</p>
            <h2 id="tx-drill-title" className="font-head text-lg">
              {label}
            </h2>
          </div>
          <button type="button" className="btn btn-secondary text-xs" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="tx-drill-stats">
          <div>
            <span className="text-xs text-codex-muted">In</span>
            <p className="tabular-nums font-medium">
              {formatTreasuryMoney(row.inflow, row.iso_currency_code)}
            </p>
          </div>
          <div>
            <span className="text-xs text-codex-muted">Out</span>
            <p className="tabular-nums font-medium">
              {formatTreasuryMoney(row.outflow, row.iso_currency_code)}
            </p>
          </div>
          <div>
            <span className="text-xs text-codex-muted">Net</span>
            <p className="tabular-nums font-medium">
              {formatTreasuryMoney(row.net, row.iso_currency_code)}
            </p>
          </div>
          <div>
            <span className="text-xs text-codex-muted">Count</span>
            <p className="tabular-nums font-medium">{row.count}</p>
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
            <TreasuryCashflowDecomposition
              decomposition={decomposition}
              contributors={contributors}
              currency={row.iso_currency_code}
              netLabel="Net for the period"
            />

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

        {cursor ? (
          <button
            type="button"
            className="btn btn-secondary text-xs mt-3"
            disabled={loading}
            onClick={() => void load(true, cursor)}
          >
            Load more
          </button>
        ) : null}

        <footer className="tx-drill-foot">
          {onOpenInTransactions ? (
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
