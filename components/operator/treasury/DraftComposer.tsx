"use client";

import { useEffect, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  IMPACT_BASIS_OPTIONS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_CATEGORY_LABELS,
  type ImpactBasis,
  type RecommendationCategory,
} from "@/lib/treasury/recommendation-status";
import type { DraftKind } from "@/lib/treasury/pickable";
import type {
  ResolvedEvidenceItem,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";

function formatEvidenceAmount(
  amount: number,
  direction: "in" | "out" | null | undefined
): string {
  const money = formatTreasuryMoney(Math.abs(amount), "USD");
  if (direction === "in") return `+${money}`;
  if (direction === "out") return `−${money}`;
  return money;
}

function itemLabel(item: ResolvedEvidenceItem): string {
  if ("label" in item && item.label) return item.label;
  if (
    item.kind === "transaction" &&
    item.available === true &&
    "payee" in item
  ) {
    return item.payee || "—";
  }
  return "Item no longer available";
}

export type DraftComposerProps = {
  clientUserId: string;
  draftKind: DraftKind;
  draft: TreasuryRecommendationRow;
  items: ResolvedEvidenceItem[];
  missingCount: number;
  onClose: () => void;
  onSent: () => void;
  onEvidenceChanged: () => void;
};

/** Evidence-aware seal/send composer — Stage 8 home is Recommendations desk. */
export function DraftComposer({
  clientUserId,
  draftKind,
  draft,
  items,
  missingCount,
  onClose,
  onSent,
  onEvidenceChanged,
}: DraftComposerProps) {
  const isQuestion = draftKind === "question";
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RecommendationCategory | "">("");
  const [body, setBody] = useState("");
  const [impactAmount, setImpactAmount] = useState("");
  const [impactBasis, setImpactBasis] = useState<ImpactBasis | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(draft.title?.trim() ? draft.title : "");
    setBody(draft.why?.trim() ? draft.why : "");
    setCategory("");
    setImpactAmount(draft.impact_amount != null ? String(draft.impact_amount) : "");
    setImpactBasis(draft.impact_basis ?? "");
    setError(null);
  }, [draft]);

  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (isQuestion || category !== "") &&
    !busy;

  async function removeItem(id: string, evidenceKind: string) {
    setBusy(true);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_evidence",
          evidence_kind: evidenceKind,
          evidence_id: id,
        }),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Remove failed");
      return;
    }
    onEvidenceChanged();
  }

  async function send() {
    if (!canSend) return;
    if (isQuestion) {
      if (!confirm("Send question to client? Evidence will freeze with the question.")) return;
    } else {
      if (
        !confirm(
          "Seal & send to client? This freezes the evidence and makes the recommendation immutable."
        )
      ) {
        return;
      }
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
          why: body.trim(),
          ...(isQuestion ? {} : { category }),
          impact_amount:
            !isQuestion && impactAmount ? Number(impactAmount) : null,
          impact_basis: !isQuestion && impactBasis ? impactBasis : null,
        }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Send failed");
      return;
    }
    onSent();
    onClose();
  }

  return (
    <>
      <div className="txinsp-scrim" role="presentation" onClick={onClose} />
      <div
        className="reqmodal"
        role="dialog"
        aria-label={isQuestion ? "Compose question" : "Compose recommendation"}
      >
        <div className="req-head">
          <div>
            <div className="req-eyebrow">
              {isQuestion ? "Compose question" : "Compose recommendation"}
            </div>
            <h3 className="req-title">
              {items.length} item{items.length === 1 ? "" : "s"}
            </h3>
            <p className="doct">
              {isQuestion
                ? "A question is a request, not a claim — nothing is sealed."
                : "A recommendation is sealed — a judgment you put your name to."}
            </p>
          </div>
          <button type="button" className="txi-close" onClick={onClose}>
            Close ✕
          </button>
        </div>

        <div className="req-list">
          {items.map((item, idx) => {
            const key =
              "id" in item && item.id ? item.id : `${item.kind}-${idx}`;
            if (
              item.kind === "transaction" &&
              item.available === true &&
              "date" in item &&
              "payee" in item &&
              "amount" in item
            ) {
              return (
                <div key={key} className="req-item">
                  <span className="ri-d">{item.date || "—"}</span>
                  <span className="ri-p">
                    <b>{item.payee || "—"}</b>
                    {"raw_name" in item && item.raw_name ? (
                      <em>{item.raw_name}</em>
                    ) : null}
                  </span>
                  <span className={`ri-a ${item.direction === "in" ? "in" : "out"}`}>
                    {formatEvidenceAmount(item.amount, item.direction)}
                  </span>
                </div>
              );
            }
            return (
              <div key={key} className="req-item req-item-missing">
                <span className="ri-d">—</span>
                <span className="ri-p">
                  <b>{itemLabel(item)}</b>
                </span>
                {"id" in item && item.id ? (
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => void removeItem(item.id!, item.kind)}
                  >
                    ×
                  </button>
                ) : (
                  <span className="ri-a">—</span>
                )}
              </div>
            );
          })}
          {missingCount > 0 ? (
            <p className="req-missing-note">
              {missingCount} item{missingCount === 1 ? "" : "s"} no longer available
              — remove or send knowingly.
            </p>
          ) : null}
        </div>

        <div className="req-to">
          <label htmlFor="draft-title">Title</label>
          <input
            id="draft-title"
            className="req-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {!isQuestion ? (
          <div className="req-to" style={{ marginTop: 12 }}>
            <label>Category</label>
            <div className="catrow">
              {RECOMMENDATION_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`catp${category === c ? " on" : ""}`}
                  onClick={() => setCategory(c)}
                >
                  {RECOMMENDATION_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="req-note" style={{ marginTop: 12 }}>
          <label htmlFor="draft-body">
            {isQuestion ? "The question" : "Why"}
          </label>
          <textarea
            id="draft-body"
            className="req-textarea"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {!isQuestion ? (
          <div className="req-to" style={{ marginTop: 12 }}>
            <label htmlFor="draft-impact">
              Estimated impact <span className="req-opt">optional</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              <input
                id="draft-impact"
                className="req-input"
                style={{ maxWidth: 140 }}
                type="number"
                step="0.01"
                value={impactAmount}
                onChange={(e) => setImpactAmount(e.target.value)}
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
        ) : null}

        {error ? (
          <p className="panel-note" style={{ color: "var(--su-neg)" }} role="alert">
            {error}
          </p>
        ) : null}

        <div className="req-acts">
          <button
            type="button"
            className="btn sm"
            disabled={!canSend}
            onClick={() => void send()}
          >
            {isQuestion ? "Send question" : "Seal & send"}
          </button>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="req-foot frz">
          {isQuestion
            ? "Sending freezes the evidence above with the question."
            : "Sealing freezes the evidence above under your name."}
        </p>
      </div>
    </>
  );
}
