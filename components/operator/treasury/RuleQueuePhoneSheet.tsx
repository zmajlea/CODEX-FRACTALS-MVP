"use client";

import { useRef } from "react";
import { RulePhonePortal } from "@/components/operator/treasury/RulePhonePortal";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";
import { formatTreasuryMoney } from "@/lib/treasury/format";

type FacetSelection =
  | { kind: "all_suggested" }
  | { kind: "combo"; labels: string[] }
  | { kind: "confirmed" }
  | { kind: "rejected" };

type Facets = {
  combos: Array<{ labels: string[]; count: number }>;
  confirmed: number;
  rejected: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  payee: string;
  category: string;
  suggestedCount: number;
  facets: Facets | null;
  facetSel: FacetSelection | null;
  onFacetSel: (sel: FacetSelection) => void;
  rows: TreasuryTransactionRow[];
  queueLoading: boolean;
  confirmBusy: boolean;
  onConfirmAll: () => void;
  onConfirm: (tx: TreasuryTransactionRow) => void;
  onReject: (tx: TreasuryTransactionRow) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
};

function formatCombo(labels: string[]): string {
  if (labels.length === 1) return `${labels[0]} only`;
  return labels.join(" + ");
}

function amountClass(tx: TreasuryTransactionRow): string {
  return tx.direction === "in" ? "rm-tx-a in" : "rm-tx-a";
}

function formatAmt(tx: TreasuryTransactionRow): string {
  const n = Number(tx.amount);
  const base = formatTreasuryMoney(Math.abs(n), "USD");
  if (tx.direction === "out") return `−${base}`;
  return base;
}

function SwipeTxCard({
  tx,
  showActions,
  onConfirm,
  onReject,
}: {
  tx: TreasuryTransactionRow;
  showActions: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const startX = useRef<number | null>(null);

  return (
    <div
      className="rm-txcard"
      onTouchStart={(e) => {
        startX.current = e.changedTouches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (startX.current == null || !showActions) return;
        const end = e.changedTouches[0]?.clientX ?? startX.current;
        const dx = end - startX.current;
        startX.current = null;
        if (dx > 64) onConfirm();
        else if (dx < -64) onReject();
      }}
    >
      <div className="rm-tx-top">
        <span className="rm-tx-d">{tx.posted_date ?? "—"}</span>
        <span className={amountClass(tx)}>{formatAmt(tx)}</span>
      </div>
      <div className="rm-tx-p">
        {tx.merchant_name ?? tx.normalized_merchant ?? tx.description ?? "—"}
      </div>
      {showActions ? (
        <div className="rm-tx-acts">
          <button type="button" className="rm-btn ghost neg sm" onClick={onReject}>
            Reject
          </button>
          <button type="button" className="rm-btn primary sm" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RuleQueuePhoneSheet({
  open,
  onClose,
  payee,
  category,
  suggestedCount,
  facets,
  facetSel,
  onFacetSel,
  rows,
  queueLoading,
  confirmBusy,
  onConfirmAll,
  onConfirm,
  onReject,
  onLoadMore,
  hasMore,
}: Props) {
  const allSuggested =
    (facets?.combos ?? []).reduce((a, c) => a + c.count, 0) || suggestedCount;
  const confirmedN = facets?.confirmed ?? 0;
  const rejectedN = facets?.rejected ?? 0;
  const tab =
    facetSel?.kind === "confirmed"
      ? "confirmed"
      : facetSel?.kind === "rejected"
        ? "rejected"
        : "suggested";

  return (
    <RulePhonePortal open={open} aria-label="Review queue">
      <div className="rm-sheet">
        <div className="rm-appbar">
          <button type="button" className="rm-ic" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="rm-ttl">
            <h2>
              {payee} → {category}
            </h2>
            <small>Review queue</small>
          </div>
        </div>
        <div className="rm-seg onnavy">
          <button
            type="button"
            className={tab === "suggested" ? "on" : undefined}
            onClick={() => onFacetSel({ kind: "all_suggested" })}
          >
            Suggested <span className="n">{allSuggested}</span>
          </button>
          <button
            type="button"
            className={tab === "confirmed" ? "on" : undefined}
            onClick={() => onFacetSel({ kind: "confirmed" })}
          >
            Confirmed <span className="n">{confirmedN}</span>
          </button>
          <button
            type="button"
            className={tab === "rejected" ? "on" : undefined}
            onClick={() => onFacetSel({ kind: "rejected" })}
          >
            Rejected <span className="n">{rejectedN}</span>
          </button>
        </div>
        <div className="rm-body">
          {tab === "suggested" && (facets?.combos?.length ?? 0) > 0 ? (
            <div className="rm-chiprow">
              <button
                type="button"
                className={`rm-chip${facetSel?.kind === "all_suggested" ? " on" : ""}`}
                onClick={() => onFacetSel({ kind: "all_suggested" })}
              >
                All <span className="n">{allSuggested}</span>
              </button>
              {(facets?.combos ?? []).map((c) => {
                const on =
                  facetSel?.kind === "combo" &&
                  [...facetSel.labels].sort().join("\0") ===
                    [...c.labels].sort().join("\0");
                return (
                  <button
                    key={c.labels.join("|")}
                    type="button"
                    className={`rm-chip${on ? " on" : ""}`}
                    onClick={() =>
                      onFacetSel({ kind: "combo", labels: c.labels })
                    }
                  >
                    {formatCombo(c.labels)} <span className="n">{c.count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {queueLoading && rows.length === 0 ? (
            <p className="rm-hint">Loading queue…</p>
          ) : rows.length === 0 ? (
            <p className="rm-hint">No transactions in this bucket.</p>
          ) : (
            rows.map((tx) => (
              <SwipeTxCard
                key={tx.id}
                tx={tx}
                showActions={tab === "suggested"}
                onConfirm={() => onConfirm(tx)}
                onReject={() => onReject(tx)}
              />
            ))
          )}

          {hasMore ? (
            <button
              type="button"
              className="rm-btn ghost sm"
              disabled={queueLoading}
              onClick={onLoadMore}
            >
              {queueLoading ? "Loading…" : "Show more"}
            </button>
          ) : null}
        </div>
        {tab === "suggested" && allSuggested > 0 ? (
          <div className="rm-foot">
            <button
              type="button"
              className="rm-btn primary"
              disabled={confirmBusy}
              onClick={onConfirmAll}
            >
              {confirmBusy
                ? "Confirming…"
                : `Confirm all ${allSuggested} suggested`}
            </button>
          </div>
        ) : null}
      </div>
    </RulePhonePortal>
  );
}
