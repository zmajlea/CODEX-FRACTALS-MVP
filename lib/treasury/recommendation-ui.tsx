import type { ReactNode } from "react";
import { ExpandableTxQueryEvidence } from "@/components/treasury/ExpandableTxQueryEvidence";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type ImpactBasis,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type { TxQuerySnap } from "@/lib/treasury/evidence";
import type {
  RecommendationEvidence,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";

export const EXEC_STEPS: RecommendationStatus[] = [
  "sent",
  "accepted",
  "in_progress",
  "done",
];

/** Spec 45 — question answered (status done + client_response). */
export function isAnsweredQuestion(
  rec: Pick<
    TreasuryRecommendationRow,
    "kind" | "status" | "client_response"
  >
): boolean {
  return (
    rec.kind === "question" &&
    rec.status === "done" &&
    typeof rec.client_response === "string" &&
    rec.client_response.trim().length > 0
  );
}

/** Unread for operator: never seen, or seen before the answer landed. */
export function isAnsweredUnread(
  rec: Pick<
    TreasuryRecommendationRow,
    "kind" | "status" | "client_response" | "operator_seen_at" | "responded_at"
  >
): boolean {
  if (!isAnsweredQuestion(rec)) return false;
  if (rec.operator_seen_at == null) return true;
  if (!rec.responded_at) return true;
  return new Date(rec.operator_seen_at) < new Date(rec.responded_at);
}

export function displayStatusLabel(
  rec: Pick<
    TreasuryRecommendationRow,
    "kind" | "status" | "client_response"
  >
): string {
  if (isAnsweredQuestion(rec)) return "Answered";
  return RECOMMENDATION_STATUS_LABELS[rec.status];
}

export function statusBadgeClass(
  status: RecommendationStatus,
  opts?: { answered?: boolean; answeredUnread?: boolean }
): string {
  if (opts?.answered) {
    return opts.answeredUnread
      ? "k-answered unread"
      : "k-answered read";
  }
  if (status === "sent") return "k-proposed";
  if (status === "accepted" || status === "in_progress" || status === "done") {
    return "k-accepted";
  }
  if (status === "declined") return "k-declined";
  return "k-muted";
}

export function formatImpactLine(rec: TreasuryRecommendationRow): string {
  if (rec.impact_amount == null) return "—";
  const currency = rec.impact_unit ?? "USD";
  const money = formatTreasuryMoney(rec.impact_amount, currency);
  const basis = rec.impact_basis
    ? IMPACT_BASIS_LABELS[rec.impact_basis as ImpactBasis]
    : "";
  return basis ? `${money} ${basis}` : money;
}

export function ExecLadder({ status }: { status: RecommendationStatus }) {
  const reached =
    status === "done"
      ? 3
      : status === "in_progress"
        ? 2
        : status === "accepted"
          ? 1
          : 0;
  return (
    <div className="rec-ladder">
      {EXEC_STEPS.map((step, i) => (
        <span key={step}>
          {i > 0 ? <span className="rl-sep">›</span> : null}
          <span className={`rl-step${i <= reached ? " on" : ""}`}>
            {step === "sent" ? "Sent" : RECOMMENDATION_STATUS_LABELS[step]}
          </span>
        </span>
      ))}
    </div>
  );
}

const TRACKER_LABELS = ["Sent", "Accepted", "In progress", "Done"] as const;

/** Ana client portal — Sent | Accepted | In progress | Done */
export function ClientTracker({ status }: { status: RecommendationStatus }) {
  const reached =
    status === "done"
      ? 3
      : status === "in_progress"
        ? 2
        : status === "accepted"
          ? 1
          : 0;
  return (
    <div className="tracker" aria-label="Progress">
      {TRACKER_LABELS.map((label, i) => (
        <span key={label}>
          {i > 0 ? <span className="sep">|</span> : null}
          <span
            className={`step${
              i < reached ? " done" : i === reached ? " current" : ""
            }`}
          >
            <span className="sd" />
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function clientStatusChip(
  rec: Pick<TreasuryRecommendationRow, "kind" | "status" | "client_response">
): { className: string; label: string } {
  if (isAnsweredQuestion(rec)) {
    return { className: "chip answered", label: "Answered" };
  }
  if (rec.status === "sent") {
    return { className: "chip await", label: "Awaiting your reply" };
  }
  if (rec.status === "accepted" || rec.status === "in_progress") {
    return { className: "chip progress", label: "In progress" };
  }
  if (rec.status === "done") {
    return { className: "chip done", label: "Done" };
  }
  if (rec.status === "declined") {
    return { className: "chip declined", label: "Declined" };
  }
  return { className: "chip", label: displayStatusLabel(rec) };
}

export function formatClientImpactLine(rec: TreasuryRecommendationRow): string | null {
  if (rec.impact_amount == null) return null;
  const currency = rec.impact_unit ?? "USD";
  const money = formatTreasuryMoney(rec.impact_amount, currency);
  const basis = rec.impact_basis
    ? IMPACT_BASIS_LABELS[rec.impact_basis as ImpactBasis]
    : "";
  return basis ? `${money} ${basis}` : money;
}

export function projectedCaveatFromEvidence(
  evidence: RecommendationEvidence[]
): { caveat: string; engineLabel?: string } | null {
  for (const ev of evidence) {
    const snap = ev.snap as
      | { projected?: boolean; caveat?: string; engineLabel?: string }
      | undefined;
    if (snap?.projected && snap.caveat) {
      return { caveat: snap.caveat, engineLabel: snap.engineLabel };
    }
  }
  return null;
}

function formatClientDate(iso: string): string {
  const d = new Date(
    (iso.length <= 10 ? `${iso}T12:00:00Z` : iso).replace(/Z?$/, "Z")
  );
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function clientTxLine(
  payee: string | null | undefined,
  amount: number,
  direction: "in" | "out" | null | undefined,
  date: string
): string {
  const money = formatSigned(amount, direction);
  const who = payee?.trim() || "Unknown";
  return `A payment from ${who}: ${money}, ${formatClientDate(date)}.`;
}

function formatSigned(amount: number, direction?: "in" | "out" | null): string {
  const abs = formatTreasuryMoney(Math.abs(amount), "USD");
  if (direction === "in") return `+${abs}`;
  if (direction === "out") return `\u2212${abs}`;
  if (amount > 0) return `+${abs}`;
  if (amount < 0) return `\u2212${abs}`;
  return abs;
}

/**
 * Spec 40 §7 / Spec 45 — client evidence is frozen. Render from snap only; never re-resolve.
 */
export function FrozenEvidenceList({
  evidence,
  variant = "default",
  isQuestion = false,
}: {
  evidence: RecommendationEvidence[];
  variant?: "default" | "client";
  isQuestion?: boolean;
}) {
  if (!evidence.length) return null;

  if (variant === "client") {
    const evHeader = isQuestion
      ? "The 5 most recent similar payments, for context"
      : "What we looked at";
    const items: ReactNode[] = [];

    for (const [idx, ev] of evidence.entries()) {
      const key = "id" in ev && ev.id ? ev.id : `${ev.kind}-${idx}`;

      if (ev.kind === "transaction" && ev.snap) {
        const snap = ev.snap;
        items.push(
          <li key={key}>
            {clientTxLine(snap.payee, snap.amount, snap.direction, snap.date)}
            {snap.payee ? (
              <details className="raw-text">
                <summary>Show the original bank text</summary>
                <div className="rt-body">{snap.payee}</div>
              </details>
            ) : null}
          </li>
        );
        continue;
      }

      if (ev.kind === "txquery" && ev.snap && typeof ev.snap === "object") {
        const snap = ev.snap as TxQuerySnap;
        if (snap.rows?.length) {
          for (const [rowIdx, row] of snap.rows.entries()) {
            items.push(
              <li key={`${key}-${rowIdx}`}>
                {clientTxLine(row.payee, row.amount, row.direction, row.date)}
                {row.payee ? (
                  <details className="raw-text">
                    <summary>Show the original bank text</summary>
                    <div className="rt-body">{row.payee}</div>
                  </details>
                ) : null}
              </li>
            );
          }
        } else {
          items.push(
            <li key={key}>{snap.description ?? "Filtered view"}</li>
          );
        }
        continue;
      }

      if (ev.kind === "summary_period" && ev.snap && typeof ev.snap === "object") {
        const snap = ev.snap as {
          from?: string;
          to?: string;
          net?: number;
        };
        items.push(
          <li key={key}>
            Period {[snap.from, snap.to].filter(Boolean).join(" → ") || "—"}
            {typeof snap.net === "number"
              ? `: ${formatSigned(snap.net)}.`
              : "."}
          </li>
        );
        continue;
      }

      const snap = ev.snap as
        | {
            label?: string;
            sublabel?: string;
            amount?: number;
            direction?: "in" | "out" | null;
          }
        | undefined;
      if (snap?.label) {
        const amt =
          typeof snap.amount === "number"
            ? `: ${formatSigned(snap.amount, snap.direction)}.`
            : ".";
        items.push(
          <li key={key}>
            {snap.label}
            {snap.sublabel ? ` (${snap.sublabel})` : ""}
            {amt}
          </li>
        );
      }
    }

    if (!items.length) return null;

    return (
      <div className="evidence">
        <div className="ev-h">{evHeader}</div>
        <ul>{items}</ul>
      </div>
    );
  }

  return (
    <div className="rec-evidence">
      <div className="rec-evidence-h">
        Evidence · {evidence.length} item{evidence.length === 1 ? "" : "s"}
      </div>
      {evidence.map((ev, idx) => {
        const key =
          "id" in ev && ev.id ? ev.id : `${ev.kind}-${idx}`;

        if (ev.kind === "transaction") {
          if (ev.snap) {
            const dir = ev.snap.direction;
            return (
              <div key={key} className="req-item">
                <span className="ri-d">{ev.snap.date || "—"}</span>
                <span className="ri-p">
                  <b>{ev.snap.payee || "—"}</b>
                  {ev.snap.category ? <em>{ev.snap.category}</em> : null}
                </span>
                <span className={`ri-a ${dir === "in" ? "in" : "out"}`}>
                  {formatSigned(ev.snap.amount, dir)}
                </span>
              </div>
            );
          }
          return (
            <div key={key} className="req-item req-item-missing">
              <span className="ri-d">—</span>
              <span className="ri-p">
                <b>Item no longer available</b>
              </span>
              <span className="ri-a">—</span>
            </div>
          );
        }

        if (ev.kind === "txquery" && ev.snap && typeof ev.snap === "object") {
          const snap = ev.snap as TxQuerySnap;
          if (snap.rows && snap.rows.length > 0) {
            return (
              <ExpandableTxQueryEvidence
                key={key}
                label={snap.description ?? "Filtered view"}
                sublabel={
                  [snap.from, snap.to].filter(Boolean).join(" → ") || undefined
                }
                net={snap.net}
                rows={snap.rows}
              />
            );
          }
          return (
            <div key={key} className="req-item">
              <span className="ri-d">view</span>
              <span className="ri-p">
                <b>{snap.description ?? "Filtered view"}</b>
                {snap.from || snap.to ? (
                  <em>
                    {[snap.from, snap.to].filter(Boolean).join(" → ")}
                  </em>
                ) : null}
              </span>
              <span className="ri-a">
                {typeof snap.net === "number" ? formatSigned(snap.net) : "—"}
              </span>
            </div>
          );
        }

        if (ev.kind === "summary_period" && ev.snap && typeof ev.snap === "object") {
          const snap = ev.snap as {
            granularity?: string;
            from?: string;
            to?: string;
            net?: number;
            count?: number;
          };
          return (
            <div key={key} className="req-item">
              <span className="ri-d">{snap.granularity ?? "period"}</span>
              <span className="ri-p">
                <b>
                  {[snap.from, snap.to].filter(Boolean).join(" → ") || "Period"}
                </b>
                {typeof snap.count === "number" ? <em>{snap.count} tx</em> : null}
              </span>
              <span className="ri-a">
                {typeof snap.net === "number" ? formatSigned(snap.net) : "—"}
              </span>
            </div>
          );
        }

        const snap = ev.snap as
          | {
              label?: string;
              sublabel?: string;
              amount?: number;
              direction?: "in" | "out" | null;
              projected?: boolean;
              caveat?: string;
              engineLabel?: string;
            }
          | undefined;
        if (snap && typeof snap === "object" && snap.label) {
          return (
            <div key={key}>
              <div className="req-item">
                <span className="ri-d">{ev.kind}</span>
                <span className="ri-p">
                  <b>{snap.label}</b>
                  {snap.sublabel ? <em>{snap.sublabel}</em> : null}
                </span>
                <span className="ri-a">
                  {typeof snap.amount === "number"
                    ? formatSigned(snap.amount, snap.direction)
                    : "—"}
                </span>
              </div>
              {snap.projected && snap.caveat ? (
                <div className="caveat">
                  <span>
                    {snap.caveat}
                    {snap.engineLabel ? (
                      <>
                        {" "}
                        <span className="dd-engine">{snap.engineLabel}</span>
                      </>
                    ) : null}
                    {" "}
                    This caveat is frozen into the sealed evidence.
                  </span>
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <div key={key} className="req-item">
            <span className="ri-d">{ev.kind}</span>
            <span className="ri-p">
              <b>
                {"id" in ev && ev.id
                  ? String(ev.id).slice(0, 8)
                  : ev.kind}
              </b>
            </span>
            <span className="ri-a">—</span>
          </div>
        );
      })}
    </div>
  );
}
