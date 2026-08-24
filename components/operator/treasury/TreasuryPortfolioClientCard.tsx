"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CashModelRunwayChip } from "@/components/operator/treasury/cash-model/CashModelRunwayChip";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import type { CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";
import { isDemoPortfolioInstrument } from "@/lib/treasury/is-demo-tenant";
import type { OperatorTreasuryClientRow } from "@/components/operator/OperatorTreasuryPortfolio";

function primaryCashDisplay(row: OperatorTreasuryClientRow): string {
  const entries = Object.entries(row.total_cash_by_currency ?? {});
  if (entries.length === 1) {
    return formatTreasuryMoney(entries[0]![1], entries[0]![0]);
  }
  if (entries.length > 1) {
    return entries
      .map(([cur, amt]) => formatTreasuryMoney(amt, cur))
      .join(" · ");
  }
  return formatTreasuryMoney(row.total_cash, "USD");
}

function importFoot(row: OperatorTreasuryClientRow): string {
  const n = row.account_count;
  const acct = `${n} account${n === 1 ? "" : "s"}`;
  const when = formatTreasuryAsOf(row.last_synced_at);
  return `${acct}, imported ${when}`;
}

function statusLabel(row: OperatorTreasuryClientRow): string {
  if (row.status === "suspended") return "Suspended";
  if (row.status === "revoked") return "Revoked";
  if (row.invite_status === "pending") return "Invited";
  if (row.invite_status === "expired") return "Invite expired";
  return "Active";
}

const ATTN_FLAME = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3.5c2 3 5 4.5 5 8.5a5 5 0 0 1-10 0c0-1.6.6-2.7 1.4-3.7.3 1 .9 1.7 1.8 2 .2-2.8 1-4.9.8-6.8Z" />
  </svg>
);

type Props = {
  row: OperatorTreasuryClientRow;
  demo?: boolean;
  onChanged?: () => void;
};

export function TreasuryPortfolioClientCard({
  row,
  demo = false,
  onChanged,
}: Props) {
  const attn = Boolean(row.attention_reason?.trim());
  const industry = row.industry?.trim();
  const nextNote = row.next_note?.trim();
  const watchNote = row.watch_note?.trim();
  const openable = isDemoPortfolioInstrument(demo, row.client_email);
  const href = `/operator/treasury/clients/${row.client_user_id}`;
  const className = `clcard${attn ? " attn" : ""}`;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [runwayStatus, setRunwayStatus] = useState<CashModelRunwayStatus | null>(
    null
  );

  useEffect(() => {
    if (!openable) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/operator/treasury/clients/${row.client_user_id}/cash-model/status`
        );
        const json = (await res.json()) as {
          status?: CashModelRunwayStatus | null;
        };
        if (!cancelled) setRunwayStatus(json.status ?? null);
      } catch {
        if (!cancelled) setRunwayStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openable, row.client_user_id]);

  async function runAccess(action: "suspend" | "reactivate" | "revoke") {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${row.client_user_id}/access`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, grantId: row.grant_id }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${row.client_user_id}/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send" }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Invite failed");
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <div className="cl-head">
        <div>
          <div className="cl-name">{row.client_name}</div>
          {industry ? <div className="cl-ind">{industry}</div> : null}
        </div>
        <span className="lens-pills">
          <span className="lens-pill" title="Access status">
            {statusLabel(row)}
          </span>
          <span className="lens-pill" title="Operator access">
            OP
          </span>
          <span className="lens-pill" title="Client access">
            Client
          </span>
        </span>
      </div>
      <div className="cl-stats">
        <div className="cl-stat">
          <span className="cl-stat-l">Cash position</span>
          <span className="cl-stat-n num">{primaryCashDisplay(row)}</span>
        </div>
        <div className="cl-stat rev">
          <span className="cl-stat-l">To review</span>
          <span className="cl-stat-n num">{row.needs_label_count ?? 0}</span>
        </div>
      </div>
      {runwayStatus ? (
        <div className="cl-rows">
          <div className="cl-r">
            <span className="cl-k">Runway</span>
            <span className="cl-v">
              <CashModelRunwayChip status={runwayStatus} compact />
            </span>
          </div>
        </div>
      ) : null}
      {nextNote || watchNote ? (
        <div className="cl-rows">
          {nextNote ? (
            <div className="cl-r">
              <span className="cl-k">Next</span>
              <span className="cl-v">{nextNote}</span>
            </div>
          ) : null}
          {watchNote ? (
            <div className="cl-r">
              <span className="cl-k">Watch</span>
              <span className="cl-v">{watchNote}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {actionError ? (
        <p className="treasury-meta cm-err text-xs" role="alert">
          {actionError}
        </p>
      ) : null}
      <div
        className="cl-rows"
        onClick={(e) => e.preventDefault()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="cl-r" style={{ flexWrap: "wrap", gap: 6 }}>
          {row.invite_status === "pending" ||
          row.invite_status === "expired" ||
          row.invite_status === "none" ||
          !row.invite_status ? (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void resendInvite();
              }}
            >
              {row.invite_status === "pending" ? "Resend invite" : "Send invite"}
            </button>
          ) : null}
          {row.status === "active" ? (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void runAccess("suspend");
              }}
            >
              Suspend
            </button>
          ) : null}
          {row.status === "suspended" ? (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void runAccess("reactivate");
              }}
            >
              Reactivate
            </button>
          ) : null}
          {row.status !== "revoked" ? (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (
                  window.confirm(
                    `Revoke access for ${row.client_name}? This cannot be undone from here.`
                  )
                ) {
                  void runAccess("revoke");
                }
              }}
            >
              Revoke
            </button>
          ) : null}
        </div>
      </div>
      <div className="cl-foot">
        {attn ? (
          <span className="cl-attn">
            {ATTN_FLAME}
            {row.attention_reason}
          </span>
        ) : (
          <span className="cl-refresh">{importFoot(row)}</span>
        )}
        <span className="cl-open">
          {openable ? "Open record ›" : "Record built on FFM"}
        </span>
      </div>
    </>
  );

  if (openable) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
