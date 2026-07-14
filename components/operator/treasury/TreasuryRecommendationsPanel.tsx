"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_CATEGORY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type ImpactBasis,
  type RecommendationCategory,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type {
  TreasuryAccountView,
  TreasuryInstitutionView,
  TreasuryRecommendationRollup,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  institutions: TreasuryInstitutionView[];
  operatorName?: string | null;
  onUnreadChange?: (count: number) => void;
};

const STATUS_ORDER: Record<RecommendationStatus, number> = {
  draft: 0,
  sent: 1,
  accepted: 2,
  in_progress: 3,
  done: 4,
  declined: 5,
};

function statusBadgeClass(status: RecommendationStatus): string {
  if (status === "sent") return "k-proposed";
  if (status === "accepted" || status === "in_progress" || status === "done") return "k-accepted";
  if (status === "declined") return "k-declined";
  return "k-muted";
}

function formatImpactLine(rec: TreasuryRecommendationRow): string | null {
  if (rec.impact_amount == null) return null;
  const money = formatTreasuryMoney(rec.impact_amount, "USD");
  const basis = rec.impact_basis ? IMPACT_BASIS_LABELS[rec.impact_basis as ImpactBasis] : "";
  return basis ? `${money} ${basis}` : money;
}

function accountLabel(acct: TreasuryAccountView): string {
  const name = acct.name ?? "Account";
  return acct.mask ? `${name} ····${acct.mask}` : name;
}

export function TreasuryRecommendationsPanel({
  clientUserId,
  institutions,
  operatorName,
  onUnreadChange,
}: Props) {
  const [recommendations, setRecommendations] = useState<TreasuryRecommendationRow[]>([]);
  const [rollup, setRollup] = useState<TreasuryRecommendationRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RecommendationCategory>("liquidity");
  const [why, setWhy] = useState("");
  const [impactAmount, setImpactAmount] = useState("");
  const [impactBasis, setImpactBasis] = useState<ImpactBasis | "">("");
  const [generalAnchor, setGeneralAnchor] = useState(true);
  const [accountId, setAccountId] = useState("");

  const accounts = useMemo(
    () => institutions.flatMap((inst) => inst.accounts),
    [institutions]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        recommendations: TreasuryRecommendationRow[];
        rollup: TreasuryRecommendationRollup;
      };
      setRecommendations(data.recommendations);
      setRollup(data.rollup);
      const unread = data.recommendations.filter(
        (r) =>
          (r.status === "accepted" || r.status === "declined") && r.operator_seen_at == null
      ).length;
      onUnreadChange?.(unread);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load recommendations");
    }
    setLoading(false);
  }, [clientUserId, onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...recommendations].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      ),
    [recommendations]
  );

  async function sendRecommendation() {
    if (!title.trim() || !why.trim()) {
      setError("Title and why are required");
      return;
    }
    if (
      !confirm(
        "Send to client? This seals the recommendation — it becomes immutable and attributed to you."
      )
    ) {
      return;
    }

    setSending(true);
    setError(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          category,
          why: why.trim(),
          impact_amount: impactAmount ? Number(impactAmount) : null,
          impact_basis: impactBasis || null,
          anchor_type: generalAnchor ? "general" : "account",
          anchor_ref: generalAnchor ? null : { account_id: accountId },
          send: true,
        }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to send");
      setSending(false);
      return;
    }
    setTitle("");
    setWhy("");
    setImpactAmount("");
    setImpactBasis("");
    setGeneralAnchor(true);
    setAccountId("");
    setComposerOpen(false);
    setSending(false);
    void load();
  }

  async function patchAction(recId: string, action: string) {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${recId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Action failed");
      return;
    }
    void load();
  }

  return (
    <div>
      {rollup ? (
        <div className="rec-rollup">
          <span className="rr-i">
            <b>{rollup.awaiting}</b> awaiting response
          </span>
          <span className="rr-i">
            <b>{rollup.accepted}</b> accepted
          </span>
          <span className="rr-i">
            <b>{rollup.in_progress}</b> in progress
          </span>
          <span className="rr-i">
            <b>{rollup.done}</b> done
          </span>
          <span className="rr-i muted">
            <b>{rollup.declined}</b> declined
          </span>
          <span className="flex-1" />
          <button type="button" className="btn" onClick={() => setComposerOpen((o) => !o)}>
            New recommendation
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="panel-note text-cinnabar mb-4" role="alert">
          {error}
        </p>
      ) : null}

      {composerOpen ? (
        <div className="rec-composer">
          <div className="rc-h">Compose recommendation</div>
          <label className="rc-check">
            <input
              type="checkbox"
              checked={generalAnchor}
              onChange={(e) => setGeneralAnchor(e.target.checked)}
            />
            General, not tied to a specific line
          </label>
          {!generalAnchor ? (
            <div className="rc-f">
              <span>Anchor</span>
              <select
                className="rec-select"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="rc-note">Unanchored recommendations show a visible General flag.</p>
          )}
          <div className="rc-f">
            <span>Title</span>
            <input
              className="rec-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline for the client"
            />
          </div>
          <div className="rc-f">
            <span>Category</span>
            <select
              className="rec-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as RecommendationCategory)}
            >
              {RECOMMENDATION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {RECOMMENDATION_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="rc-f">
            <span>Why</span>
            <textarea
              className="rec-input"
              rows={4}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Explain the change and why it matters"
            />
          </div>
          <div className="rc-imp">
            <div className="rc-f">
              <span>Impact amount (optional)</span>
              <input
                className="rec-input"
                type="number"
                step="0.01"
                value={impactAmount}
                onChange={(e) => setImpactAmount(e.target.value)}
                placeholder="Operator estimate only"
              />
            </div>
            <div className="rc-f">
              <span>Basis</span>
              <select
                className="rec-select"
                value={impactBasis}
                onChange={(e) => setImpactBasis(e.target.value as ImpactBasis | "")}
              >
                <option value="">—</option>
                {(Object.keys(IMPACT_BASIS_LABELS) as ImpactBasis[]).map((b) => (
                  <option key={b} value={b}>
                    {IMPACT_BASIS_LABELS[b]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="rc-note">Impact is your estimate — the platform does not compute it.</p>
          <div className="rec-acts">
            <button type="button" className="btn" disabled={sending} onClick={() => void sendRecommendation()}>
              {sending ? "Sending…" : "Send to client"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setComposerOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-codex-muted">Loading recommendations…</p>
      ) : sorted.length === 0 ? (
        <p className="rec-empty">No recommendations yet. Compose one to send to this client.</p>
      ) : (
        <div className="rec-grid">
          {sorted.map((rec) => {
            const impact = formatImpactLine(rec);
            const sealed = rec.sealed_at != null;
            return (
              <article key={rec.id} className="rec-card">
                <div className="rec-top">
                  <span className="rec-cat">{RECOMMENDATION_CATEGORY_LABELS[rec.category]}</span>
                  <span className={`rec-badge ${statusBadgeClass(rec.status)}`}>
                    <span className="rec-bdot" />
                    {RECOMMENDATION_STATUS_LABELS[rec.status]}
                  </span>
                </div>
                <h3 className="rec-title">{rec.title}</h3>
                <p className="rec-why">
                  <span className="rw-l">Why</span>
                  {rec.why}
                </p>
                {impact ? (
                  <div className="rec-impact">
                    <span className="ri-l">Estimated impact</span>
                    <span className="ri-v">{impact}</span>
                    <span className="ri-b">Attributed to treasurer</span>
                  </div>
                ) : null}
                <div className="rec-foot">
                  {rec.anchor_type === "general" ? (
                    <span className="rec-anchor general">General</span>
                  ) : rec.anchor_ref ? (
                    <span className="rec-anchor">
                      {rec.anchor_ref.name ?? "Account"}
                      {rec.anchor_ref.mask ? ` ····${rec.anchor_ref.mask}` : ""}
                    </span>
                  ) : null}
                  {sealed ? (
                    <span className="rec-seal-line">
                      Sealed by {operatorName ?? "you"} · {formatTreasuryAsOf(rec.sealed_at)}
                    </span>
                  ) : null}
                </div>
                {rec.status === "declined" && rec.decline_reason ? (
                  <div className="rec-decline">
                    <b>Declined:</b> {rec.decline_reason}
                    {rec.decline_note ? ` — ${rec.decline_note}` : ""}
                  </div>
                ) : null}
                <div className="rec-acts">
                  {rec.status === "accepted" ? (
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => void patchAction(rec.id, "mark_in_progress")}
                    >
                      Mark in progress
                    </button>
                  ) : null}
                  {rec.status === "in_progress" ? (
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => void patchAction(rec.id, "mark_done")}
                    >
                      Mark done
                    </button>
                  ) : null}
                  {(rec.status === "accepted" || rec.status === "declined") &&
                  rec.operator_seen_at == null ? (
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => void patchAction(rec.id, "mark_seen")}
                    >
                      Mark seen
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
