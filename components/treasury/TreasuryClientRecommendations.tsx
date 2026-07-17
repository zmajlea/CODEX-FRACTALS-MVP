"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DECLINE_REASONS,
  RECOMMENDATION_CATEGORY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type DeclineReason,
} from "@/lib/treasury/recommendation-status";
import {
  ExecLadder,
  formatImpactLine,
  statusBadgeClass,
} from "@/lib/treasury/recommendation-ui";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";

type Props = {
  onUnreadChange?: (count: number) => void;
};

export function TreasuryClientRecommendations({ onUnreadChange }: Props) {
  const [recommendations, setRecommendations] = useState<TreasuryRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState<DeclineReason>(DECLINE_REASONS[0]!);
  const [declineNote, setDeclineNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/treasury/recommendations?mark_seen=1");
    if (res.ok) {
      const data = (await res.json()) as {
        recommendations: TreasuryRecommendationRow[];
        unreadCount: number;
      };
      setRecommendations(data.recommendations);
      onUnreadChange?.(data.unreadCount);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load recommendations");
    }
    setLoading(false);
  }, [onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const pending = recommendations.filter((r) => r.status === "sent");
    const rest = recommendations.filter((r) => r.status !== "sent");
    return [...pending, ...rest];
  }, [recommendations]);

  const acceptRec = sorted.find((r) => r.id === acceptId);
  const declineRec = sorted.find((r) => r.id === declineId);

  async function patchAction(recId: string, action: string, extra?: Record<string, string>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/treasury/recommendations/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Action failed");
      setBusy(false);
      return false;
    }
    setAcceptId(null);
    setDeclineId(null);
    setDeclineNote("");
    setBusy(false);
    void load();
    return true;
  }

  return (
    <div>
      <div className="lens-banner mb-4">
        These are the changes your treasurer has proposed. Read each one, then accept or decline.
      </div>

      {error ? (
        <p className="panel-note mb-4" style={{ color: "var(--su-neg)" }} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="treasury-muted">Loading recommendations…</p>
      ) : sorted.length === 0 ? (
        <p className="rec-empty">
          No recommendations yet. When your treasurer proposes a change, it will appear here.
        </p>
      ) : (
        <div className="rec-grid">
          {sorted.map((rec) => {
            const pending = rec.status === "sent";
            const showLadder =
              rec.status === "accepted" || rec.status === "in_progress" || rec.status === "done";
            return (
              <article
                key={rec.id}
                className={`rec-card client${pending ? " pending" : ""}`}
              >
                <div className="rec-top">
                  <span className="rec-cat">{RECOMMENDATION_CATEGORY_LABELS[rec.category]}</span>
                  {!pending && rec.status !== "draft" ? (
                    <span className={`rec-badge ${statusBadgeClass(rec.status)}`}>
                      <span className="rec-bdot" />
                      {RECOMMENDATION_STATUS_LABELS[rec.status]}
                    </span>
                  ) : null}
                </div>
                <h3 className="rec-title">{rec.title}</h3>
                <p className="rec-why">
                  <span className="rw-l">Why</span>
                  {rec.why}
                </p>
                <div className="rec-impact">
                  <span className="ri-l">Estimated impact</span>
                  <span className="ri-v">{formatImpactLine(rec)}</span>
                  <span className="ri-b">Attributed to your treasurer</span>
                </div>
                {rec.evidence?.length ? (
                  <div className="rec-evidence">
                    <div className="rec-evidence-h">
                      Evidence · {rec.evidence.length} item
                      {rec.evidence.length === 1 ? "" : "s"}
                    </div>
                    {rec.evidence.map((ev) => {
                      if (ev.kind !== "transaction") return null;
                      if (ev.snap) {
                        const dir = ev.snap.direction;
                        const abs = formatTreasuryMoney(Math.abs(ev.snap.amount), "USD");
                        const amt =
                          dir === "in" ? `+${abs}` : dir === "out" ? `−${abs}` : abs;
                        return (
                          <div key={ev.id} className="req-item">
                            <span className="ri-d">{ev.snap.date || "—"}</span>
                            <span className="ri-p">
                              <b>{ev.snap.payee || "—"}</b>
                              {ev.snap.category ? <em>{ev.snap.category}</em> : null}
                            </span>
                            <span className={`ri-a ${dir === "in" ? "in" : "out"}`}>
                              {amt}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={ev.id} className="req-item req-item-missing">
                          <span className="ri-d">—</span>
                          <span className="ri-p">
                            <b>Item no longer available</b>
                          </span>
                          <span className="ri-a">—</span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {showLadder ? <ExecLadder status={rec.status} /> : null}
                {rec.status === "declined" ? (
                  <div className="rec-decline">
                    You declined this
                    {rec.decline_reason ? `: ${rec.decline_reason.toLowerCase()}` : ""}.
                  </div>
                ) : null}
                {pending ? (
                  <div className="rec-acts">
                    <button type="button" className="btn text-xs" onClick={() => setAcceptId(rec.id)}>
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn decline text-xs"
                      onClick={() => {
                        setDeclineReason(DECLINE_REASONS[0]!);
                        setDeclineId(rec.id);
                      }}
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {acceptRec ? (
        <div className="tx-drill-overlay" role="presentation">
          <div className="tx-drill-modal" role="dialog" aria-modal="true" aria-labelledby="rec-accept-title">
            <div className="tx-drill-head">
              <div>
                <p className="eyebrow">Accept recommendation</p>
                <h3 id="rec-accept-title" className="sec-title" style={{ margin: 0 }}>
                  {acceptRec.title}
                </h3>
              </div>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => setAcceptId(null)}>
                Close
              </button>
            </div>
            <p className="treasury-muted mb-4">
              You are accepting this recommendation. That commits it, and your treasurer will begin
              the work. You will see it move to In progress, then Done.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void patchAction(acceptRec.id, "accept")}
              >
                Accept and commit
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAcceptId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {declineRec ? (
        <div className="tx-drill-overlay" role="presentation">
          <div className="tx-drill-modal" role="dialog" aria-modal="true" aria-labelledby="rec-decline-title">
            <div className="tx-drill-head">
              <div>
                <p className="eyebrow">Decline recommendation</p>
                <h3 id="rec-decline-title" className="sec-title" style={{ margin: 0 }}>
                  {declineRec.title}
                </h3>
              </div>
              <button type="button" className="btn btn-secondary text-xs" onClick={() => setDeclineId(null)}>
                Close
              </button>
            </div>
            <label className="rc-f block mb-3">
              <span>Reason</span>
              <select
                className="rec-select"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value as DeclineReason)}
              >
                {DECLINE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="rc-f block mb-4">
              <span>Note (optional)</span>
              <textarea
                className="rec-input"
                rows={2}
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
                placeholder="Add any context for your treasurer"
              />
            </label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void patchAction(declineRec.id, "decline", {
                    decline_reason: declineReason,
                    decline_note: declineNote,
                  })
                }
              >
                Decline
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDeclineId(null)}>
                Cancel
              </button>
            </div>
            <p className="treasury-meta-fine">
              Declined recommendations are final. Your treasurer can propose a fresh one instead.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
