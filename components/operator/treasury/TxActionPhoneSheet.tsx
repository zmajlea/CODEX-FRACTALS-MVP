"use client";

import { RulePhonePortal } from "@/components/operator/treasury/RulePhonePortal";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";
import { formatTreasuryMoney } from "@/lib/treasury/format";

type Props = {
  open: boolean;
  tx: TreasuryTransactionRow | null;
  onClose: () => void;
  onMakeRule: (tx: TreasuryTransactionRow) => void;
  onCategorize?: (tx: TreasuryTransactionRow) => void;
};

export function TxActionPhoneSheet({
  open,
  tx,
  onClose,
  onMakeRule,
  onCategorize,
}: Props) {
  if (!tx) return null;

  const title =
    tx.merchant_name ?? tx.normalized_merchant ?? tx.description ?? "Transaction";
  const amt = formatTreasuryMoney(Math.abs(Number(tx.amount)), "USD");

  return (
    <RulePhonePortal
      open={open}
      className="rm-overlay--scrim"
      aria-label="Transaction actions"
    >
      <button
        type="button"
        className="rm-overlay-dismiss"
        aria-label="Dismiss"
        style={{ position: "absolute", inset: 0, border: 0, background: "transparent" }}
        onClick={onClose}
      />
      <div className="rm-sheet" style={{ position: "relative", zIndex: 1 }}>
        <div className="rm-grab" aria-hidden />
        <div className="rm-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <div className="rm-card">
            <div className="rm-tx-top">
              <span className="rm-tx-d">{tx.posted_date ?? "—"}</span>
              <span className={tx.direction === "in" ? "rm-tx-a in" : "rm-tx-a"}>
                {tx.direction === "out" ? `−${amt}` : amt}
              </span>
            </div>
            <div className="rm-tx-p">{title}</div>
          </div>
        </div>
        <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {onCategorize && !tx.label ? (
            <button
              type="button"
              className="rm-sheet-act"
              onClick={() => {
                onCategorize(tx);
                onClose();
              }}
            >
              Categorize
            </button>
          ) : null}
          <button
            type="button"
            className="rm-sheet-act"
            onClick={() => {
              onMakeRule(tx);
              onClose();
            }}
          >
            Make a rule from this transaction
          </button>
          <button type="button" className="rm-sheet-act" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </RulePhonePortal>
  );
}
