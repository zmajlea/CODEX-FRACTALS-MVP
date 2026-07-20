"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  ResolvedEvidenceItem,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";
import type { Evidence, ProjectedFigureSnap } from "@/lib/treasury/evidence";
import { evidenceRunningTotal } from "@/lib/treasury/evidence";
import { postPickableToDraft } from "@/lib/treasury/post-pickable";
import {
  consumeDraftsPickAnnounce,
  getDraftsDrawerOpen,
  getLastPickKind,
  setDraftsDrawerOpenFromUi,
  subscribeDraftsDrawer,
} from "@/lib/treasury/drafts-drawer-session";

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

function itemFig(
  item: ResolvedEvidenceItem,
  snap?: ProjectedFigureSnap
): { text: string; dir: "in" | "out" | null } {
  if ("amount" in item && typeof item.amount === "number") {
    const dir =
      "direction" in item && (item.direction === "in" || item.direction === "out")
        ? item.direction
        : null;
    return {
      text: formatEvidenceAmount(item.amount, dir),
      dir,
    };
  }
  if (typeof snap?.amount === "number") {
    return {
      text: formatEvidenceAmount(snap.amount, snap.direction),
      dir: snap.direction ?? null,
    };
  }
  if ("sublabel" in item && item.sublabel) return { text: item.sublabel, dir: null };
  if (snap?.sublabel) return { text: snap.sublabel, dir: null };
  return { text: itemLabel(item), dir: null };
}

function projectedSnap(
  bundle: DraftBundle,
  idx: number
): ProjectedFigureSnap | undefined {
  const raw = bundle?.draft.evidence?.[idx];
  if (!raw || !("snap" in raw) || !raw.snap || typeof raw.snap !== "object") {
    return undefined;
  }
  const snap = raw.snap as ProjectedFigureSnap;
  if (snap.projected || snap.caveat || snap.engineLabel) return snap;
  return undefined;
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

const REF_KINDS = new Set([
  "transaction",
  "study",
  "rule",
  "account",
  "import",
  "recommendation",
]);

function evidenceToPickable(
  ev: Evidence,
  item: ResolvedEvidenceItem
): Pickable | null {
  const label = itemLabel(item);
  const sublabel =
    "sublabel" in item && item.sublabel
      ? item.sublabel
      : "amount" in item && typeof item.amount === "number"
        ? formatEvidenceAmount(
            item.amount,
            "direction" in item ? item.direction : null
          )
        : undefined;

  if (REF_KINDS.has(ev.kind)) {
    const id = "id" in ev ? ev.id : undefined;
    if (!id) return null;
    return {
      kind: ev.kind as Pickable["kind"],
      ref: id,
      label,
      sublabel,
      snap:
        "snap" in ev && ev.snap && typeof ev.snap === "object"
          ? (ev.snap as Record<string, unknown>)
          : undefined,
    };
  }

  if (!("params" in ev) || !ev.params || Object.keys(ev.params).length === 0) {
    return null;
  }
  return {
    kind: ev.kind as Pickable["kind"],
    params: ev.params,
    label,
    sublabel,
    snap:
      "snap" in ev && ev.snap && typeof ev.snap === "object"
        ? (ev.snap as Record<string, unknown>)
        : undefined,
  };
}

function peekLine(
  bundle: DraftBundle,
  kind: DraftKind
): string {
  if (!bundle || bundle.items.length === 0) {
    return kind === "question"
      ? "Nothing in this question yet."
      : "Nothing in this recommendation yet.";
  }
  const first = bundle.items[0]!;
  const snap = projectedSnap(bundle, 0);
  const fig = itemFig(first, snap);
  return fig.text;
}

function itemKey(item: ResolvedEvidenceItem, idx: number): string {
  return "id" in item && item.id ? item.id : `${item.kind}-${idx}`;
}

export function DraftsRail({
  clientUserId,
  clientName = "this client",
  refreshKey,
  onOpenChange,
  onOpenDraft,
  onNavigateEvidence,
  pickNotice,
  onClearPickNotice,
  onSetPickNotice,
}: {
  clientUserId: string;
  clientName?: string;
  refreshKey: number;
  /** Stage 7b — parent reflows main content while drawer is open. */
  onOpenChange?: (open: boolean) => void;
  /** Stage 8 — open draft on the Recommendations desk (no inline compose). */
  onOpenDraft?: (draftId: string) => void;
  /** Stage 8a-4 — jump from basket item to its source surface. */
  onNavigateEvidence?: (nav: EvidenceNavRequest) => void;
  /** Spec 43 / 8b-3 — duplicate / error acknowledgement. */
  pickNotice?: string | null;
  onClearPickNotice?: () => void;
  /** Spec 46e 9a — Move collision reuses the same notice channel. */
  onSetPickNotice?: (msg: string) => void;
}) {
  const [data, setData] = useState<DraftsPayload>({
    recommendation: null,
    question: null,
  });
  const [drawerOpen, setDrawerOpen] = useState(() => getDraftsDrawerOpen());
  const [pulse, setPulse] = useState(false);
  const [expanded, setExpanded] = useState<DraftKind>("recommendation");
  const [settleKey, setSettleKey] = useState<string | null>(null);
  const [srText, setSrText] = useState("");
  const [updating, setUpdating] = useState<{
    recommendation?: boolean;
    question?: boolean;
  }>({});
  const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());
  const [groupError, setGroupError] = useState<{
    recommendation?: string;
    question?: string;
  }>({});
  const [moving, setMoving] = useState(false);
  const snapshotRef = useRef<DraftsPayload | null>(null);
  const prevItemKeysRef = useRef<{ recommendation: Set<string>; question: Set<string> }>({
    recommendation: new Set(),
    question: new Set(),
  });

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

  useEffect(() => {
    return subscribeDraftsDrawer(() => {
      setDrawerOpen(getDraftsDrawerOpen());
    });
  }, []);

  // Pick settle: pulse if drawer stayed closed; expand target kind; announce
  useEffect(() => {
    if (refreshKey <= 0) return;
    const kind = getLastPickKind();
    if (kind) setExpanded(kind);
    if (!getDraftsDrawerOpen()) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 450);
      return () => window.clearTimeout(t);
    }
    const announce = consumeDraftsPickAnnounce();
    if (announce) setSrText(announce);
  }, [refreshKey]);

  // After load, mark the newly added chip for settle animation
  useEffect(() => {
    const kinds: DraftKind[] = ["recommendation", "question"];
    for (const kind of kinds) {
      const bundle = data[kind];
      const prev = prevItemKeysRef.current[kind];
      const next = new Set(
        (bundle?.items ?? []).map((it, i) => itemKey(it, i))
      );
      if (refreshKey > 0) {
        for (const k of next) {
          if (!prev.has(k)) {
            setSettleKey(`${kind}:${k}`);
            const t = window.setTimeout(() => setSettleKey(null), 400);
            prevItemKeysRef.current[kind] = next;
            return () => window.clearTimeout(t);
          }
        }
      }
      prevItemKeysRef.current[kind] = next;
    }
  }, [data, refreshKey]);

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

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDraftsDrawerOpenFromUi(false);
      }
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

  function toggleDrawer() {
    setDraftsDrawerOpenFromUi(!getDraftsDrawerOpen());
  }

  function closeDrawer() {
    setDraftsDrawerOpenFromUi(false);
  }

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

  async function moveItem(from: DraftKind, idx: number) {
    const to: DraftKind = from === "recommendation" ? "question" : "recommendation";
    const bundle = from === "recommendation" ? data.recommendation : data.question;
    if (!bundle || moving) return;
    const item = bundle.items[idx];
    const ev = bundle.draft.evidence?.[idx] as Evidence | undefined;
    if (!item || !ev || !("id" in item) || !item.id) return;

    const pickable = evidenceToPickable(ev, item);
    if (!pickable) {
      setGroupError((e) => ({
        ...e,
        [from]: "Cannot move this evidence kind yet",
      }));
      return;
    }

    setMoving(true);
    setGroupError((e) => ({ ...e, [from]: undefined, [to]: undefined }));
    try {
      const result = await postPickableToDraft(clientUserId, to, pickable);
      if (result.duplicate) {
        onSetPickNotice?.(
          `Already added to this ${to === "question" ? "question" : "recommendation"}.`
        );
        // leave-put — do not remove from source
        return;
      }
      await removeItem(from, item.id, item.kind);
      setExpanded(to);
      void load();
    } catch (e) {
      setGroupError((err) => ({
        ...err,
        [from]: e instanceof Error ? e.message : "Move failed",
      }));
    } finally {
      setMoving(false);
    }
  }

  function openInDrafts(draftId: string) {
    closeDrawer();
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
    closeDrawer();
    onNavigateEvidence?.(nav);
  }

  function renderAccordion(kind: DraftKind, title: string, bundle: DraftBundle) {
    const n = bundle?.items.length ?? 0;
    const busy = !!updating[kind];
    const isOpen = expanded === kind;
    const running =
      kind === "recommendation" ? recTotal : qTotal;
    const peek = peekLine(bundle, kind);
    const moveLabel =
      kind === "recommendation" ? "Move to question" : "Move to recommendation";

    return (
      <div className={`dd-acc${isOpen ? " open" : ""}`} key={kind}>
        <button
          type="button"
          className="dd-acc-h"
          aria-expanded={isOpen}
          onClick={() => setExpanded(kind)}
        >
          <span className="dd-acc-kind">{title}</span>
          <span className="dd-acc-n">
            {n}
            {busy ? " · …" : ""}
          </span>
          {!isOpen ? <span className="dd-acc-peek">{peek}</span> : null}
        </button>
        {isOpen ? (
          <div className="dd-acc-body">
            {bundle ? (
              <button
                type="button"
                className="btng dd-open-desk"
                onClick={() => openInDrafts(bundle.draft.id)}
              >
                Open in Drafts →
              </button>
            ) : null}
            {groupError[kind] ? (
              <p className="dg-err" role="alert">
                {groupError[kind]}
              </p>
            ) : null}
            {n === 0 ? (
              <p className="dd-nochips">
                No figures yet. Use + Add to draft on any surface to add
                evidence, or seal on your words alone.
              </p>
            ) : (
              <div className="dd-chips">
                {bundle!.items.map((item, idx) => {
                  const key = itemKey(item, idx);
                  const pendKey =
                    "id" in item && item.id ? `${kind}:${item.id}` : "";
                  const removing = pendKey
                    ? pendingRemove.has(pendKey)
                    : false;
                  const blocked = navBlockedReason(item);
                  const canNav = !blocked && !!onNavigateEvidence;
                  const snap = projectedSnap(bundle, idx);
                  const fig = itemFig(item, snap);
                  const settle =
                    settleKey === `${kind}:${key}` ? " settle" : "";
                  const figClass =
                    fig.dir === "in"
                      ? "dd-chip-fig in"
                      : fig.dir === "out"
                        ? "dd-chip-fig out"
                        : "dd-chip-fig";
                  const ariaFig = fig.text;
                  return (
                    <div
                      key={key}
                      className={`dd-chip${settle}${removing ? " pend" : ""}`}
                      data-chip={idx}
                      tabIndex={0}
                      role="group"
                      aria-label={`Evidence: ${ariaFig}, ${item.kind}. Press Delete to remove.`}
                      onKeyDown={(e) => {
                        if (
                          (e.key === "Delete" || e.key === "Backspace") &&
                          "id" in item &&
                          item.id
                        ) {
                          e.preventDefault();
                          void removeItem(kind, item.id!, item.kind);
                        }
                      }}
                    >
                      <div className="dd-chip-top">
                        <button
                          type="button"
                          className={figClass}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: canNav ? "pointer" : "default",
                            textAlign: "left",
                            font: "inherit",
                          }}
                          disabled={!canNav}
                          title={blocked ?? "Open source"}
                          onClick={() => navigateItem(kind, item, idx)}
                        >
                          {fig.text}
                        </button>
                        {"id" in item && item.id ? (
                          <button
                            type="button"
                            className="dd-chip-x"
                            disabled={removing || busy || moving}
                            onClick={() =>
                              void removeItem(kind, item.id!, item.kind)
                            }
                            aria-label={`Remove ${fig.text} from this draft`}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                      <div className="dd-chip-prov">
                        {itemLabel(item)}
                        {running && idx === 0
                          ? ` · ${item.kind}`
                          : ` · ${item.kind}`}
                      </div>
                      {snap?.projected && snap.caveat ? (
                        <div className="dd-chip-caveat">
                          {snap.caveat}
                          {snap.engineLabel ? (
                            <span className="dd-engine">{snap.engineLabel}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {"id" in item && item.id ? (
                        <button
                          type="button"
                          className="btn ghost sm dd-chip-move"
                          disabled={removing || busy || moving}
                          onClick={() => void moveItem(kind, idx)}
                        >
                          {moveLabel}
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
        ) : null}
      </div>
    );
  }

  return (
    <>
      <aside
        className={`railtab${pulse && !drawerOpen ? " pulse" : ""}`}
        title="Drafts — everything you pick collects here"
        onClick={toggleDrawer}
        aria-expanded={drawerOpen}
      >
        <span className={`ct${total === 0 ? " zero" : ""}`}>{total}</span>
        <span className="vt">Drafts</span>
      </aside>

      <aside
        className={`drawer${drawerOpen ? " open" : ""}`}
        role="complementary"
        aria-label="Drafts"
      >
        {drawerOpen ? (
          <button
            type="button"
            className="railtab close-twin"
            title="Close drafts"
            aria-label="Close drafts"
            onClick={closeDrawer}
          >
            <span className="vt">Close</span>
          </button>
        ) : null}
        <div className="dd-head">
          <div>
            <div className="dd-title">Drafts</div>
            <div className="dd-kicker">{clientName} record</div>
          </div>
          <button
            type="button"
            className="dd-close"
            onClick={closeDrawer}
            aria-label="Close drafts"
          >
            ×
          </button>
        </div>
        <div className="dd-sr" role="status" aria-live="polite">
          {srText}
        </div>
        {pickNotice ? (
          <p className="dg-err" role="status" style={{ margin: "8px 14px 0" }}>
            {pickNotice}{" "}
            {onClearPickNotice ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={onClearPickNotice}
              >
                Dismiss
              </button>
            ) : null}
          </p>
        ) : null}
        <div className="dd-body drawer-b">
          {renderAccordion(
            "recommendation",
            "Recommendation",
            data.recommendation
          )}
          {renderAccordion("question", "Question", data.question)}
          {total === 0 ? (
            <p className="dd-empty-t" style={{ marginTop: 8 }}>
              Nothing in draft yet. Pick a figure with + Add to draft on any
              surface, or start here.
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
