"use client";

import { useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { TxQuerySnapRow } from "@/lib/treasury/evidence";

function formatSigned(amount: number, direction?: "in" | "out" | null): string {
  const abs = formatTreasuryMoney(Math.abs(amount), "USD");
  if (direction === "in") return `+${abs}`;
  if (direction === "out") return `\u2212${abs}`;
  if (amount > 0) return `+${abs}`;
  if (amount < 0) return `\u2212${abs}`;
  return abs;
}

/** Spec 45 — expandable bounded txquery rows (snap or live). Collapsed by default. */
export function ExpandableTxQueryEvidence({
  label,
  sublabel,
  net,
  rows,
}: {
  label: string;
  sublabel?: string;
  net?: number;
  rows: TxQuerySnapRow[];
}) {
  const [open, setOpen] = useState(false);
  const n = rows.length;

  return (
    <div className="req-item-txquery">
      <button
        type="button"
        className="req-item req-item-expand"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ri-d" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="ri-p">
          <b>{label}</b>
          {sublabel ? <em>{sublabel}</em> : null}
          <em className="ri-view">{open ? "Hide" : `View ${n}`}</em>
        </span>
        <span className="ri-a">
          {typeof net === "number" ? formatSigned(net) : "—"}
        </span>
      </button>
      {open ? (
        <div className="req-txquery-rows" role="list">
          {rows.map((row, i) => (
            <div
              key={`${row.date}-${row.payee ?? ""}-${i}`}
              className="req-item req-item-nested"
              role="listitem"
            >
              <span className="ri-d">{row.date || "—"}</span>
              <span className="ri-p">
                <b>{row.payee || "—"}</b>
              </span>
              <span
                className={`ri-a ${row.direction === "in" ? "in" : "out"}`}
              >
                {formatSigned(row.amount, row.direction)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
