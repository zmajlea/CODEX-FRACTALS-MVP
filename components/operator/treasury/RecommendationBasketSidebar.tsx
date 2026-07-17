"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  IMPACT_BASIS_OPTIONS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_CATEGORY_LABELS,
  type ImpactBasis,
  type RecommendationCategory,
} from "@/lib/treasury/recommendation-status";
import type {
  ResolvedEvidenceItem,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  open: boolean;
  draft: TreasuryRecommendationRow;
  items: ResolvedEvidenceItem[];
  missingCount: number;
  onClose: () => void;
  onSealed: () => void;
  onEvidenceChanged: () => void;
};

function formatEvidenceAmount(
  amount: number,
  direction: "in" | "out" | null
): string {
  const money = formatTreasuryMoney(Math.abs(amount), "USD");
  if (direction === "in") return `+${money}`;
  if (direction === "out") return `−${money}`;
  return money;
}

export function RecommendationComposer({
  clientUserId,
  open,
  draft,
  items,
  missingCount,
  onClose,
  onSealed,
  onEvidenceChanged,
}: Props) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RecommendationCategory | "">("");
  const [why, setWhy] = useState("");
  const [impactAmount, setImpactAmount] = useState("");
  const [impactBasis, setImpactBasis] = useState<ImpactBasis | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(draft.title?.trim() ? draft.title : "");
    setWhy(draft.why?.trim() ? draft.why : "");
    // Never pre-select category from DB placeholder — explicit choice required
    setCategory("");
    setImpactAmount(
      draft.impact_amount != null ? String(draft.impact_amount) : ""
    );
    setImpactBasis(draft.impact_basis ?? "");
    setError(null);
  }, [open, draft]);

  const canSeal =
    title.trim().length > 0 &&
    why.trim().length > 0 &&
    category !== "" &&
    !busy;

  async function removeItem(id: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_evidence",
          evidence_kind: "transaction",
          evidence_id: id,
        }),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Remove failed");
      return;
    }
    onEvidenceChanged();
  }

  async function sealAndSend() {
    if (!title.trim() || !why.trim() || !category || busy) return;
    if (
      !confirm(
        "Seal & send to client? This freezes the evidence and makes the recommendation immutable."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          title: title.trim(),
          why: why.trim(),
          category,
          impact_amount: impactAmount ? Number(impactAmount) : null,
          impact_basis: impactBasis || null,
        }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Seal failed");
      return;
    }
    onSealed();
    onClose();
  }

  if (!open) return null;

  const liveCount = items.filter((i) => i.available).length;
  const totalCited = items.length;

  return (
    <>
      <div className="txinsp-scrim" role="presentation" onClick={onClose} />
      <div className="reqmodal" role="dialog" aria-label="Make the recommendation">
        <div className="req-head">
          <div>
            <div className="req-eyebrow">Make the recommendation</div>
            <h3 className="req-title">
              {totalCited} transaction{totalCited === 1 ? "" : "s"} selected
            </h3>
          </div>
          <button type="button" className="txi-close" onClick={onClose}>
            Close ✕
          </button>
        </div>

        <div className="req-list">
          {items.map((item) =>
            item.available ? (
              <div key={item.id} className="req-item">
                <span className="ri-d">{item.date || "—"}</span>
                <span className="ri-p">
                  <b>{item.payee || "—"}</b>
                  {item.raw_name ? <em>{item.raw_name}</em> : null}
                </span>
                <span className={`ri-a ${item.direction === "in" ? "in" : "out"}`}>
                  {formatEvidenceAmount(item.amount, item.direction)}
                </span>
              </div>
            ) : (
              <div key={item.id} className="req-item req-item-missing">
                <span className="ri-d">—</span>
                <span className="ri-p">
                  <b>Item no longer available</b>
                </span>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void removeItem(item.id)}
                  aria-label="Remove unavailable item"
                >
                  ×
                </button>
              </div>
            )
          )}
          {missingCount > 0 ? (
            <p className="req-missing-note">
              {missingCount} item{missingCount === 1 ? "" : "s"} no longer available
              — remove or seal knowingly.
            </p>
          ) : null}
          {liveCount === 0 && missingCount === 0 ? (
            <p className="panel-note">No lines selected.</p>
          ) : null}
        </div>

        <div className="req-to">
          <label htmlFor="rec-title-inp">Title</label>
          <input
            id="rec-title-inp"
            className="req-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short title for the client"
          />
        </div>

        <div className="req-to" style={{ marginTop: 12 }}>
          <label htmlFor="rec-cat-inp">Category</label>
          <select
            id="rec-cat-inp"
            className="req-input"
            value={category}
            onChange={(e) =>
              setCategory((e.target.value || "") as RecommendationCategory | "")
            }
          >
            <option value="">Choose category…</option>
            {RECOMMENDATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {RECOMMENDATION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div className="req-note" style={{ marginTop: 12 }}>
          <label htmlFor="rec-why-inp">
            Why <span className="req-opt">required</span>
          </label>
          <textarea
            id="rec-why-inp"
            className="req-textarea"
            rows={3}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Why this change matters for the client"
          />
        </div>

        <div className="req-to" style={{ marginTop: 12 }}>
          <label htmlFor="rec-impact-inp">
            Estimated impact <span className="req-opt">optional</span>
          </label>
          <div className="flex gap-2 flex-wrap">
            <input
              id="rec-impact-inp"
              className="req-input"
              style={{ maxWidth: 140 }}
              type="number"
              step="0.01"
              value={impactAmount}
              onChange={(e) => setImpactAmount(e.target.value)}
              placeholder="Amount"
            />
            <select
              className="req-input"
              style={{ maxWidth: 160 }}
              value={impactBasis}
              onChange={(e) =>
                setImpactBasis((e.target.value || "") as ImpactBasis | "")
              }
            >
              <option value="">Basis…</option>
              {IMPACT_BASIS_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {IMPACT_BASIS_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p className="panel-note" style={{ color: "var(--su-neg)" }} role="alert">
            {error}
          </p>
        ) : null}

        <div className="req-acts">
          <button
            type="button"
            className="btn sm"
            disabled={!canSeal}
            onClick={() => void sealAndSend()}
          >
            Seal &amp; send
          </button>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="req-foot">
          Sealing freezes the evidence list. The client sees exactly what you sealed.
        </p>
      </div>
    </>
  );
}

export function useRecommendationDraft(clientUserId: string, refreshKey: number) {
  const [draft, setDraft] = useState<TreasuryRecommendationRow | null>(null);
  const [items, setItems] = useState<ResolvedEvidenceItem[]>([]);
  const [missingCount, setMissingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/draft`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        draft: TreasuryRecommendationRow | null;
        items: ResolvedEvidenceItem[];
        missingCount: number;
      };
      setDraft(data.draft);
      setItems(data.items ?? []);
      setMissingCount(data.missingCount ?? 0);
    } else {
      setDraft(null);
      setItems([]);
      setMissingCount(0);
    }
    setLoading(false);
  }, [clientUserId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { draft, items, missingCount, loading, reload: load };
}

export function evidenceHeaderTotal(items: ResolvedEvidenceItem[]): string | null {
  const available = items.filter((i) => i.available);
  if (available.length === 0) return null;
  const dirs = new Set(available.map((i) => i.direction));
  if (dirs.size !== 1) return null;
  const direction = [...dirs][0];
  if (direction !== "in" && direction !== "out") return null;
  const total = available.reduce((sum, i) => sum + Math.abs(i.amount), 0);
  return formatEvidenceAmount(total, direction);
}

export function RecommendationBasketSidebar({
  clientUserId,
  refreshKey,
  onRefreshConsumed,
}: {
  clientUserId: string;
  refreshKey: number;
  onRefreshConsumed?: () => void;
}) {
  const { draft, items, missingCount, reload } = useRecommendationDraft(
    clientUserId,
    refreshKey
  );
  const [dismissed, setDismissed] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (refreshKey > 0) {
      setDismissed(false);
      onRefreshConsumed?.();
    }
  }, [refreshKey, onRefreshConsumed]);

  const headerTotal = useMemo(() => evidenceHeaderTotal(items), [items]);

  async function removeItem(id: string) {
    if (!draft) return;
    setBusy(true);
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_evidence",
          evidence_kind: "transaction",
          evidence_id: id,
        }),
      }
    );
    setBusy(false);
    void reload();
  }

  async function clearAll() {
    if (!draft) return;
    if (!confirm("Clear all evidence from this draft?")) return;
    setBusy(true);
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_evidence" }),
      }
    );
    setBusy(false);
    setComposerOpen(false);
    void reload();
  }

  if (!draft || items.length === 0) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        className="rec-basket-badge"
        onClick={() => setDismissed(false)}
        aria-label="Open recommendation draft"
      >
        {items.length}
      </button>
    );
  }

  return (
    <>
      <aside className="rec-basket" aria-label="Recommendation draft">
        <div className="rec-basket-head">
          <div>
            <div className="rec-basket-eyebrow">Recommendation draft</div>
            <div className="rec-basket-meta">
              {items.length} transaction{items.length === 1 ? "" : "s"}
              {headerTotal ? ` · ${headerTotal}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="txi-close"
            onClick={() => setDismissed(true)}
            aria-label="Collapse draft"
          >
            ×
          </button>
        </div>
        <div className="rec-basket-list">
          {items.map((item) =>
            item.available ? (
              <div key={item.id} className="rec-basket-row">
                <span className="ri-d">{item.date || "—"}</span>
                <span className="ri-p">{item.payee || "—"}</span>
                <span className={`ri-a ${item.direction === "in" ? "in" : "out"}`}>
                  {formatEvidenceAmount(item.amount, item.direction)}
                </span>
                <button
                  type="button"
                  className="rec-basket-x"
                  disabled={busy}
                  onClick={() => void removeItem(item.id)}
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ) : (
              <div key={item.id} className="rec-basket-row missing">
                <span className="ri-p">Item no longer available</span>
                <button
                  type="button"
                  className="rec-basket-x"
                  disabled={busy}
                  onClick={() => void removeItem(item.id)}
                  aria-label="Remove unavailable"
                >
                  ×
                </button>
              </div>
            )
          )}
          {missingCount > 0 ? (
            <p className="rec-basket-missing">
              {missingCount} item{missingCount === 1 ? "" : "s"} no longer available
            </p>
          ) : null}
        </div>
        <div className="rec-basket-acts">
          <button
            type="button"
            className="btn sm"
            onClick={() => setComposerOpen(true)}
          >
            Make the recommendation
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => void clearAll()}
          >
            Clear
          </button>
        </div>
      </aside>

      <RecommendationComposer
        clientUserId={clientUserId}
        open={composerOpen}
        draft={draft}
        items={items}
        missingCount={missingCount}
        onClose={() => setComposerOpen(false)}
        onSealed={() => void reload()}
        onEvidenceChanged={() => void reload()}
      />
    </>
  );
}
