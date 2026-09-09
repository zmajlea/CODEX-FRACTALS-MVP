"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  IMPACT_BASIS_OPTIONS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_CATEGORY_LABELS,
  type ImpactBasis,
  type RecommendationCategory,
} from "@/lib/treasury/recommendation-status";
import {
  currentRuleContextN,
  isRuleContextCompanion,
  RULE_CONTEXT_MAX_N,
  RULE_CONTEXT_MIN_N,
  type ProjectedFigureSnap,
} from "@/lib/treasury/evidence";
import { ExpandableTxQueryEvidence } from "@/components/treasury/ExpandableTxQueryEvidence";
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
  const [contextN, setContextN] = useState(5);
  /** B24 Part 3 — autosave + inline send preflight. */
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [confirming, setConfirming] = useState(false);
  const editedRef = useRef(false);

  const showContextN = useMemo(() => {
    if (!isQuestion) return false;
    return draft.evidence.some(
      (ev) => ev.kind === "rule" || isRuleContextCompanion(ev)
    );
  }, [isQuestion, draft.evidence]);

  useEffect(() => {
    setTitle(draft.title?.trim() ? draft.title : "");
    setBody(draft.why?.trim() ? draft.why : "");
    setCategory("");
    setImpactAmount(draft.impact_amount != null ? String(draft.impact_amount) : "");
    setImpactBasis(draft.impact_basis ?? "");
    setContextN(currentRuleContextN(draft.evidence));
    setError(null);
    editedRef.current = false;
    setSaveState("idle");
  }, [draft]);

  /** B24 — persist composer fields to the draft (autosave + flush on close). */
  const saveDraft = useCallback(async () => {
    if (!editedRef.current) return;
    setSaveState("saving");
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_draft",
          title: title.trim(),
          why: body.trim(),
          ...(isQuestion ? {} : { category: category || undefined }),
          impact_amount:
            !isQuestion && impactAmount ? Number(impactAmount) : null,
          impact_basis: !isQuestion && impactBasis ? impactBasis : null,
        }),
      }
    );
    if (res.ok) setSaveState("saved");
    else setSaveState("idle");
  }, [
    clientUserId,
    draft.id,
    isQuestion,
    title,
    body,
    category,
    impactAmount,
    impactBasis,
  ]);

  // Debounced autosave once the operator has edited (words never vanish on close).
  useEffect(() => {
    if (!editedRef.current) return;
    const t = setTimeout(() => void saveDraft(), 800);
    return () => clearTimeout(t);
  }, [title, body, category, impactAmount, impactBasis, saveDraft]);

  function markEdited() {
    editedRef.current = true;
    setSaveState("idle");
  }

  function closeWithSave() {
    void saveDraft();
    onClose();
  }

  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (isQuestion || category !== "") &&
    !busy;

  async function setRuleContextN(next: number) {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_rule_context_n", n: next }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not update context N");
      setContextN(currentRuleContextN(draft.evidence));
      return;
    }
    setContextN(next);
    onEvidenceChanged();
  }

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
    setConfirming(false);
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
      <div className="txinsp-scrim" role="presentation" onClick={closeWithSave} />
      <div
        className="reqmodal"
        role="dialog"
        aria-label={isQuestion ? "Compose question" : "Compose recommendation"}
      >
        <div className="req-head">
          <div>
            <div className="req-eyebrow">
              {isQuestion ? "Compose question" : "Compose recommendation"}
              <span className="req-private"> · private until sent</span>
            </div>
            <h3 className="req-title">
              {items.length} item{items.length === 1 ? "" : "s"}
              <span className="req-savestate" aria-live="polite">
                {saveState === "saving"
                  ? " · Saving…"
                  : saveState === "saved"
                    ? " · Draft saved"
                    : ""}
              </span>
            </h3>
            <p className="doct">
              {isQuestion
                ? "A question is a request, not a claim — nothing is sealed."
                : "A recommendation is sealed — a judgment you put your name to."}
            </p>
          </div>
          <button type="button" className="txi-close" onClick={closeWithSave}>
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
                  {"id" in item && item.id ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => void removeItem(item.id!, item.kind)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            }
            if (
              item.kind === "forecast" &&
              item.available === true
            ) {
              const raw = draft.evidence[idx];
              const snap =
                raw?.kind === "forecast" && raw.snap && typeof raw.snap === "object"
                  ? (raw.snap as ProjectedFigureSnap)
                  : undefined;
              return (
                <div key={key}>
                  <div className="req-item">
                    <span className="ri-d">forecast</span>
                    <span className="ri-p">
                      <b>{itemLabel(item)}</b>
                      {item.sublabel ? <em>{item.sublabel}</em> : null}
                      {snap?.projected ? (
                        <em className="chip await" style={{ display: "inline-block", marginTop: 4 }}>
                          projected
                        </em>
                      ) : null}
                    </span>
                    <span className="ri-a">
                      {typeof item.amount === "number"
                        ? formatEvidenceAmount(item.amount, item.direction)
                        : snap?.sublabel ?? "—"}
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
                    ) : null}
                  </div>
                  {snap?.projected && snap.caveat ? (
                    <div className="caveat dd-chip-caveat">
                      <span>
                        {snap.caveat}
                        {snap.engineLabel ? (
                          <span className="dd-engine">{snap.engineLabel}</span>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            }
            if (
              item.kind === "txquery" &&
              item.available === true &&
              "rows" in item &&
              Array.isArray(item.rows) &&
              item.rows.length > 0
            ) {
              return (
                <div key={key} className="req-draft-txquery">
                  <ExpandableTxQueryEvidence
                    label={item.label}
                    sublabel={item.sublabel}
                    net={
                      typeof item.amount === "number"
                        ? item.direction === "out"
                          ? -item.amount
                          : item.amount
                        : undefined
                    }
                    rows={item.rows}
                  />
                  {"id" in item && item.id ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => void removeItem(item.id!, item.kind)}
                    >
                      ×
                    </button>
                  ) : null}
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
            onChange={(e) => {
              setTitle(e.target.value);
              markEdited();
            }}
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
                  onClick={() => {
                    setCategory(c);
                    markEdited();
                  }}
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
            onChange={(e) => {
              setBody(e.target.value);
              markEdited();
            }}
          />
        </div>

        {showContextN ? (
          <div className="req-to" style={{ marginTop: 12 }}>
            <label htmlFor="draft-context-n">Last N for context</label>
            <div className="flex gap-2 items-center flex-wrap">
              <input
                id="draft-context-n"
                className="req-input"
                style={{ maxWidth: 88 }}
                type="number"
                min={RULE_CONTEXT_MIN_N}
                max={RULE_CONTEXT_MAX_N}
                step={1}
                value={contextN}
                disabled={busy}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  setContextN(Number.isFinite(raw) ? raw : contextN);
                }}
                onBlur={() => {
                  if (
                    !Number.isInteger(contextN) ||
                    contextN < RULE_CONTEXT_MIN_N ||
                    contextN > RULE_CONTEXT_MAX_N
                  ) {
                    setError(`N must be an integer from ${RULE_CONTEXT_MIN_N} to ${RULE_CONTEXT_MAX_N}`);
                    setContextN(currentRuleContextN(draft.evidence));
                    return;
                  }
                  if (contextN !== currentRuleContextN(draft.evidence)) {
                    void setRuleContextN(contextN);
                  }
                }}
              />
              <span className="panel-note" style={{ margin: 0 }}>
                Recent transactions like this rule — for context
              </span>
            </div>
          </div>
        ) : null}

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
                onChange={(e) => {
                  setImpactAmount(e.target.value);
                  markEdited();
                }}
              />
              <select
                className="req-input"
                style={{ maxWidth: 160 }}
                value={impactBasis}
                onChange={(e) => {
                  setImpactBasis((e.target.value || "") as ImpactBasis | "");
                  markEdited();
                }}
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

        {confirming ? (
          <div className="req-preflight" role="group" aria-label="Send preflight">
            <div className="req-pf-head">
              {isQuestion ? "Send this question?" : "Seal & send this recommendation?"}
            </div>
            <ul className="req-pf-checks">
              <li className={title.trim() ? "ok" : "miss"}>Title</li>
              <li className={body.trim() ? "ok" : "miss"}>
                {isQuestion ? "The question" : "Why"}
              </li>
              {!isQuestion ? (
                <li className={category !== "" ? "ok" : "miss"}>Category</li>
              ) : null}
              <li className="ok">
                {items.length} evidence item{items.length === 1 ? "" : "s"}
                {missingCount > 0 ? ` · ${missingCount} unavailable` : ""}
              </li>
            </ul>
            <p className="req-pf-vis">
              <b>Private now</b> → visible to {"the client"} the moment you send.
              {isQuestion
                ? " Evidence freezes with the question."
                : " Evidence freezes under your name and the recommendation becomes immutable."}
            </p>
            <div className="req-acts">
              <button
                type="button"
                className="btn sm"
                disabled={!canSend}
                onClick={() => void send()}
              >
                {isQuestion ? "Send question" : "Seal & send"}
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setConfirming(false)}
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="req-acts">
              <button
                type="button"
                className="btn sm"
                disabled={!canSend}
                onClick={() => setConfirming(true)}
              >
                {isQuestion ? "Review & send" : "Review & seal"}
              </button>
              <button type="button" className="btn ghost sm" onClick={closeWithSave}>
                Close
              </button>
            </div>
            <p className="req-foot frz">
              {isQuestion
                ? "Sending freezes the evidence above with the question."
                : "Sealing freezes the evidence above under your name."}
            </p>
          </>
        )}
      </div>
    </>
  );
}
