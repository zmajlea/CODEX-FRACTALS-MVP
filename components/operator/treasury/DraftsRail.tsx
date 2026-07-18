"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { DraftKind } from "@/lib/treasury/pickable";
import type {
  ResolvedEvidenceItem,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";
import type { Evidence } from "@/lib/treasury/evidence";
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

/** Stage 8a-4 — parent resolves these into tab + focus state. */
export type EvidenceNavRequest =
  | { kind: "transaction"; id: string }
  | { kind: "txquery"; params: Record<string, unknown> }
  | { kind: "study"; id: string }
  | { kind: "rule"; id: string }
  | {
      kind: "summary_period" | "summary_range";
      params: Record<string, unknown>;
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

function navFromEvidence(ev: Evidence | undefined): EvidenceNavRequest | null {
  if (!ev) return null;
  if (ev.kind === "transaction" && ev.id) {
    return { kind: "transaction", id: ev.id };
  }
  if (ev.kind === "study" && ev.id) {
    return { kind: "study", id: ev.id };
  }
  if (ev.kind === "rule" && ev.id) {
    return { kind: "rule", id: ev.id };
  }
  if (ev.kind === "txquery" && ev.params) {
    return { kind: "txquery", params: ev.params };
  }
  if (
    (ev.kind === "summary_period" || ev.kind === "summary_range") &&
    ev.params
  ) {
    return { kind: ev.kind, params: ev.params };
  }
  return null;
}

function navBlockedReason(item: ResolvedEvidenceItem): string | null {
  if (!item.available) return "No longer available — cannot open";
  if (
    item.kind === "transaction" ||
    item.kind === "txquery" ||
    item.kind === "study" ||
    item.kind === "rule" ||
    item.kind === "summary_period" ||
    item.kind === "summary_range"
  ) {
    return null;
  }
  return `No jump target for ${item.kind} yet`;
}

export function DraftsRail({
  clientUserId,
  refreshKey,
  onOpenChange,
  onOpenDraft,
  onNavigateEvidence,
}: {
  clientUserId: string;
  refreshKey: number;
  /** Stage 7b — parent reflows main content while drawer is open. */
  onOpenChange?: (open: boolean) => void;
  /** Stage 8 — open draft on the Recommendations desk (no inline compose). */
  onOpenDraft?: (draftId: string) => void;
  /** Stage 8a-4 — jump from basket item to its source surface. */
  onNavigateEvidence?: (nav: EvidenceNavRequest) => void;
}) {
  const [data, setData] = useState<DraftsPayload>({
    recommendation: null,
    question: null,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [updating, setUpdating] = useState<{
    recommendation?: boolean;
    question?: boolean;
  }>({});
  const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());
  const [groupError, setGroupError] = useState<{
    recommendation?: string;
    question?: string;
  }>({});
  const snapshotRef = useRef<DraftsPayload | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/draft`
    );
    if (!res.ok) {
      setUpdating({});
      return;
    }
    const body = (await res.json()) as DraftsPayload;
    setData({
      recommendation: body.recommendation ?? null,
      question: body.question ?? null,
    });
    setUpdating({});
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

  // 8a-1 — when a pick lands while the drawer is open, show Updating… until load settles
  const prevRefreshRef = useRef(refreshKey);
  useEffect(() => {
    if (
      refreshKey > 0 &&
      refreshKey !== prevRefreshRef.current &&
      drawerOpen
    ) {
      setUpdating({ recommendation: true, question: true });
    }
    prevRefreshRef.current = refreshKey;
  }, [refreshKey, drawerOpen]);

  useEffect(() => {
    onOpenChange?.(drawerOpen);
    const app = document.getElementById("app");
    app?.classList.toggle("drafts-drawer-open", drawerOpen);
    return () => {
      app?.classList.remove("drafts-drawer-open");
    };
  }, [drawerOpen, onOpenChange]);

  // 8a-3 — Esc closes
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

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

  async function removeItem(
    kind: DraftKind,
    id: string,
    evidenceKind: string
  ) {
    const bundle = kind === "recommendation" ? data.recommendation : data.question;
    if (!bundle) return;
    const pendKey = `${kind}:${id}`;
    if (pendingRemove.has(pendKey)) return;

    snapshotRef.current = {
      recommendation: data.recommendation,
      question: data.question,
    };
    setGroupError((e) => ({ ...e, [kind]: undefined }));
    setPendingRemove((s) => new Set(s).add(pendKey));
    setUpdating((u) => ({ ...u, [kind]: true }));

    const nextItems = bundle.items.filter(
      (it) => !("id" in it && it.id === id)
    );
    const removedMissing =
      bundle.items.find((it) => "id" in it && it.id === id)?.available === false
        ? 1
        : 0;
    setData((prev) => ({
      ...prev,
      [kind]: {
        ...bundle,
        items: nextItems,
        missingCount: Math.max(0, bundle.missingCount - removedMissing),
      },
    }));

    const res = await fetch(
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

    setPendingRemove((s) => {
      const next = new Set(s);
      next.delete(pendKey);
      return next;
    });
    setUpdating((u) => ({ ...u, [kind]: false }));

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (snapshotRef.current) setData(snapshotRef.current);
      setGroupError((e) => ({
        ...e,
        [kind]: body.error ?? "Remove failed — restored",
      }));
      return;
    }
    void load();
  }

  async function clearDraft(kind: DraftKind) {
    const bundle = kind === "recommendation" ? data.recommendation : data.question;
    if (!bundle || updating[kind]) return;

    snapshotRef.current = {
      recommendation: data.recommendation,
      question: data.question,
    };
    setGroupError((e) => ({ ...e, [kind]: undefined }));
    setUpdating((u) => ({ ...u, [kind]: true }));
    setData((prev) => ({
      ...prev,
      [kind]: { ...bundle, items: [], missingCount: 0 },
    }));

    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${bundle.draft.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_evidence" }),
      }
    );

    setUpdating((u) => ({ ...u, [kind]: false }));

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (snapshotRef.current) setData(snapshotRef.current);
      setGroupError((e) => ({
        ...e,
        [kind]: body.error ?? "Clear failed — restored",
      }));
      return;
    }
    void load();
  }

  function openInDrafts(draftId: string) {
    setDrawerOpen(false);
    onOpenDraft?.(draftId);
  }

  function navigateItem(
    kind: DraftKind,
    item: ResolvedEvidenceItem,
    idx: number
  ) {
    if (navBlockedReason(item)) return;
    const bundle = kind === "recommendation" ? data.recommendation : data.question;
    if (!bundle) return;
    const ev = bundle.draft.evidence?.[idx] as Evidence | undefined;
    const nav = navFromEvidence(ev);
    if (!nav) return;
    setDrawerOpen(false);
    onNavigateEvidence?.(nav);
  }

  function renderGroup(
    kind: DraftKind,
    title: string,
    bundle: DraftBundle,
    running: ReturnType<typeof evidenceRunningTotal>
  ) {
    const n = bundle?.items.length ?? 0;
    const busy = !!updating[kind];
    return (
      <div className="dg" key={kind}>
        <div className="dg-h">
          <span className="t">{title}</span>
          <span className="n">
            {n} item{n === 1 ? "" : "s"}
            {running
              ? ` · ${formatEvidenceAmount(running.total, running.direction)}`
              : ""}
            {busy ? <em className="dg-upd"> · Updating…</em> : null}
          </span>
          {bundle ? (
            <button
              type="button"
              className="btng"
              onClick={() => openInDrafts(bundle.draft.id)}
            >
              Open in Drafts →
            </button>
          ) : null}
        </div>
        {groupError[kind] ? (
          <p className="dg-err" role="alert">
            {groupError[kind]}
          </p>
        ) : null}
        {n === 0 ? (
          <p className="dg-hint">Nothing here yet.</p>
        ) : (
          <div className="dg-list">
            {bundle!.items.map((item, idx) => {
              const key =
                "id" in item && item.id ? item.id : `${item.kind}-${idx}`;
              const pendKey =
                "id" in item && item.id ? `${kind}:${item.id}` : "";
              const removing = pendKey ? pendingRemove.has(pendKey) : false;
              const blocked = navBlockedReason(item);
              const canNav = !blocked && !!onNavigateEvidence;
              return (
                <div
                  key={key}
                  className={`dit ${item.kind === "transaction" ? "m" : "s"}${canNav ? " nav" : ""}${removing ? " pend" : ""}`}
                >
                  <button
                    type="button"
                    className="dit-body"
                    disabled={!canNav}
                    title={blocked ?? "Open source"}
                    onClick={() => navigateItem(kind, item, idx)}
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
                      {blocked && !item.available ? (
                        <em className="dit-dead"> — {blocked}</em>
                      ) : null}
                    </span>
                  </button>
                  {"id" in item && item.id ? (
                    <button
                      type="button"
                      className="rm"
                      disabled={removing || busy}
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
              disabled={busy}
              onClick={() => void clearDraft(kind)}
            >
              {busy ? "Updating…" : "Clear"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <aside
        className={`railtab${pulse && !drawerOpen ? " pulse" : ""}`}
        title="Drafts — everything you pick collects here"
        onClick={() => setDrawerOpen((o) => !o)}
        aria-expanded={drawerOpen}
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
          <span className="drawer-sub">collector · compose on the desk</span>
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
                <rect
                  x="32"
                  y="90"
                  width="72"
                  height="23"
                  rx="8"
                  fill="var(--paper)"
                  stroke="var(--brand-2)"
                />
                <text
                  x="68"
                  y="105"
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight="600"
                  fill="var(--brand)"
                  style={{ fontFamily: "var(--font-ui)" }}
                >
                  Recommend
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
                Both drafts stay open side by side. Open in Drafts → to compose
                and send from Recommendations.
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
    </>
  );
}
