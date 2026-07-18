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
import type { DraftKind } from "@/lib/treasury/pickable";
import type {
  ResolvedEvidenceItem,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";
import { evidenceRunningTotal } from "@/lib/treasury/evidence";

type DraftBundle = {
  draft: TreasuryRecommendationRow;
  items: ResolvedEvidenceItem[];
  missingCount: number;
} | null;

type DraftsPayload = {
  recommendation: DraftBundle;
  question: DraftBundle;
};

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

type ComposerProps = {
  clientUserId: string;
  draftKind: DraftKind;
  draft: TreasuryRecommendationRow;
  items: ResolvedEvidenceItem[];
  missingCount: number;
  onClose: () => void;
  onSent: () => void;
  onEvidenceChanged: () => void;
};

function DraftComposer({
  clientUserId,
  draftKind,
  draft,
  items,
  missingCount,
  onClose,
  onSent,
  onEvidenceChanged,
}: ComposerProps) {
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

  // Spec 40 / mockup gate: title; recommendation also needs explicit category
  const canSend =
    title.trim().length > 0 && (isQuestion || category !== "") && !busy;

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

export function DraftsRail({
  clientUserId,
  refreshKey,
  onOpenChange,
}: {
  clientUserId: string;
  refreshKey: number;
  /** Stage 7b — parent reflows main content while drawer is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [data, setData] = useState<DraftsPayload>({
    recommendation: null,
    question: null,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [composeKind, setComposeKind] = useState<DraftKind | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/draft`
    );
    if (!res.ok) return;
    const body = (await res.json()) as DraftsPayload;
    setData({
      recommendation: body.recommendation ?? null,
      question: body.question ?? null,
    });
  }, [clientUserId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Pick pulses the tab + bumps the badge count only — never auto-opens (Stage 7b).
  useEffect(() => {
    if (refreshKey > 0) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 450);
      return () => window.clearTimeout(t);
    }
  }, [refreshKey]);

  useEffect(() => {
    onOpenChange?.(drawerOpen);
    const app = document.getElementById("app");
    app?.classList.toggle("drafts-drawer-open", drawerOpen);
    return () => {
      app?.classList.remove("drafts-drawer-open");
    };
  }, [drawerOpen, onOpenChange]);

  const recCount = data.recommendation?.items.length ?? 0;
  const qCount = data.question?.items.length ?? 0;
  const total = recCount + qCount;

  const recTotal = useMemo(
    () =>
      data.recommendation
        ? evidenceRunningTotal(data.recommendation.items)
        : null,
    [data.recommendation]
  );
  const qTotal = useMemo(
    () => (data.question ? evidenceRunningTotal(data.question.items) : null),
    [data.question]
  );

  async function clearDraft(kind: DraftKind) {
    const bundle = kind === "recommendation" ? data.recommendation : data.question;
    if (!bundle) return;
    if (!confirm(`Clear all evidence from this ${kind}?`)) return;
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${bundle.draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_evidence" }),
      }
    );
    void load();
  }

  async function removeItem(kind: DraftKind, id: string, evidenceKind: string) {
    const bundle = kind === "recommendation" ? data.recommendation : data.question;
    if (!bundle) return;
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${bundle.draft.id}`,
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
    void load();
  }

  function renderGroup(
    kind: DraftKind,
    title: string,
    bundle: DraftBundle,
    running: ReturnType<typeof evidenceRunningTotal>
  ) {
    const n = bundle?.items.length ?? 0;
    return (
      <div className="dg" key={kind}>
        <div className="dg-h">
          <span className="t">{title}</span>
          <span className="n">
            {n} item{n === 1 ? "" : "s"}
            {running
              ? ` · ${formatEvidenceAmount(running.total, running.direction)}`
              : ""}
          </span>
          {n > 0 ? (
            <button
              type="button"
              className="btng"
              onClick={() => setComposeKind(kind)}
            >
              Compose
            </button>
          ) : null}
        </div>
        {n === 0 ? (
          <p className="dg-hint">Nothing here yet.</p>
        ) : (
          <div className="dg-list">
            {bundle!.items.map((item, idx) => {
              const key =
                "id" in item && item.id ? item.id : `${item.kind}-${idx}`;
              return (
                <div
                  key={key}
                  className={`dit ${item.kind === "transaction" ? "m" : "s"}`}
                >
                  <span className="kk">{item.kind}</span>
                  <span className="bd">
                    {itemLabel(item)}
                    {item.available &&
                    item.kind === "transaction" &&
                    "amount" in item ? (
                      <em>
                        {" "}
                        {formatEvidenceAmount(item.amount, item.direction)}
                      </em>
                    ) : null}
                  </span>
                  {"id" in item && item.id ? (
                    <button
                      type="button"
                      className="rm"
                      onClick={() => void removeItem(kind, item.id!, item.kind)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
            {(bundle?.missingCount ?? 0) > 0 ? (
              <p className="rec-basket-missing">
                {bundle!.missingCount} item
                {bundle!.missingCount === 1 ? "" : "s"} no longer available
              </p>
            ) : null}
            <button
              type="button"
              className="btn ghost sm"
              style={{ marginTop: 8 }}
              onClick={() => void clearDraft(kind)}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    );
  }

  const composing =
    composeKind === "recommendation"
      ? data.recommendation
      : composeKind === "question"
        ? data.question
        : null;

  return (
    <>
      <aside
        className={`railtab${pulse && !drawerOpen ? " pulse" : ""}`}
        title="Drafts — everything you pick collects here"
        onClick={() => setDrawerOpen(true)}
      >
        <span className={`ct${total === 0 ? " zero" : ""}`}>{total}</span>
        <span className="vt">Drafts</span>
      </aside>

      <aside
        className={`drawer${drawerOpen ? " open" : ""}`}
        aria-label="Drafts"
      >
        <div className="drawer-h">
          <b>Drafts</b>
          <span className="drawer-sub">two open drafts · pick as you go</span>
          <button
            type="button"
            className="x"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close drafts"
          >
            ×
          </button>
        </div>
        <div className="drawer-b">
          {total === 0 ? (
            <div className="drafts-empty">
              <svg
                viewBox="0 0 264 140"
                role="img"
                aria-label="A pick splits into two drafts: Recommendation or Question"
              >
                <circle
                  cx="132"
                  cy="21"
                  r="12.5"
                  fill="var(--paper)"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                />
                <path
                  d="M132 15.5 V26.5 M126.5 21 H137.5"
                  stroke="var(--brand)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path
                  d="M132 34 V55"
                  stroke="var(--brand-2)"
                  strokeOpacity=".4"
                  strokeWidth="1.25"
                />
                <path
                  d="M132 55 C132 73 68 71 68 90"
                  fill="none"
                  stroke="var(--brand-2)"
                  strokeOpacity=".4"
                  strokeWidth="1.25"
                />
                <path
                  d="M132 55 C132 73 196 71 196 90"
                  fill="none"
                  stroke="var(--brand-2)"
                  strokeOpacity=".4"
                  strokeWidth="1.25"
                />
                <circle cx="132" cy="55" r="2.5" fill="var(--brand-2)" />
                <rect
                  x="18"
                  y="90"
                  width="100"
                  height="23"
                  rx="8"
                  fill="var(--brand)"
                />
                <text
                  x="68"
                  y="105"
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight="600"
                  fill="var(--paper)"
                  style={{ fontFamily: "var(--font-ui)" }}
                >
                  Recommendation
                </text>
                <rect
                  x="160"
                  y="90"
                  width="72"
                  height="23"
                  rx="8"
                  fill="var(--paper)"
                  stroke="var(--brand-2)"
                />
                <text
                  x="196"
                  y="105"
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight="600"
                  fill="var(--brand)"
                  style={{ fontFamily: "var(--font-ui)" }}
                >
                  Question
                </text>
                <text
                  x="68"
                  y="128"
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="var(--mute)"
                  style={{ fontFamily: "var(--font-ui)" }}
                >
                  seal & send
                </text>
                <text
                  x="196"
                  y="128"
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="var(--mute)"
                  style={{ fontFamily: "var(--font-ui)" }}
                >
                  ask client
                </text>
              </svg>
              <p className="de-title">Nothing picked yet</p>
              <p className="de-body">
                Hit the <span className="de-plus">+</span> on anything — a
                transaction, a study, a chart period — and choose which draft it
                feeds.
              </p>
              <p className="de-hint">
                Both drafts stay open side by side. Your picks stay here as you
                move around the app.
              </p>
            </div>
          ) : (
            <>
              {renderGroup(
                "recommendation",
                "Recommendation",
                data.recommendation,
                recTotal
              )}
              {renderGroup("question", "Question", data.question, qTotal)}
            </>
          )}
        </div>
      </aside>

      {composing && composeKind ? (
        <DraftComposer
          clientUserId={clientUserId}
          draftKind={composeKind}
          draft={composing.draft}
          items={composing.items}
          missingCount={composing.missingCount}
          onClose={() => setComposeKind(null)}
          onSent={() => void load()}
          onEvidenceChanged={() => void load()}
        />
      ) : null}
    </>
  );
}
