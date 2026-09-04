"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MetricsTab } from "@/components/operator/treasury/analytics/MetricsTab";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import { MetricComparisonChart } from "@/components/operator/treasury/analytics/MetricComparisonChart";
import {
  MetricComparisonTable,
  MetricSeriesTable,
} from "@/components/operator/treasury/analytics/MetricTable";
import { ReviewDraftsPanel } from "@/components/operator/treasury/ReviewDraftsPanel";
import { StudiesPanel } from "@/components/operator/treasury/StudiesPanel";
import { StudyBlockView } from "@/components/operator/treasury/StudyBlockView";
import type { MetricComparison } from "@/lib/treasury/metrics-eval";
import { isPlacedStudySnapshot } from "@/lib/treasury/study-assemble";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import { postPickableToDraft } from "@/lib/treasury/post-pickable";
import {
  PINNED_WINDOW_PRESETS,
  type PinnedWindow,
  type PinnedWindowPreset,
  isPinnedWindow,
} from "@/lib/treasury/pinned-window";

type ReviewItem = {
  id: string;
  title: string;
  period_month: string;
  status: string;
  current_version: number;
  reply_count?: number;
};

type BlockItem = {
  id: string;
  position: number;
  role: string;
  metric_id: string | null;
  recommendation_id: string | null;
  study_id?: string | null;
  caption: string;
  body: string;
  proposal_state: string;
  metric_name?: string | null;
  suggested_caption?: string;
  pinned_window?: PinnedWindow | null;
  view_mode?: "chart" | "table";
  placed_snapshot?: Record<string, unknown> | null;
};

type Preflight = {
  proposed_count: number;
  stale_count: number;
  envelope_violations: Array<{ field: string; message: string }>;
  stale_block_ids: string[];
  proposed_block_ids: string[];
};

type MetricRow = {
  id: string;
  name: string;
  kind: string;
  computed_at: string | null;
};

type Props = {
  clientUserId: string;
  dataThrough?: string | null;
};

type PendingAction =
  | { kind: "archive"; review: ReviewItem }
  | { kind: "delete"; review: ReviewItem };

function stateChip(
  block: BlockItem,
  staleIds: string[],
  reviewStatus: string
): string {
  if (block.proposal_state === "proposed") return "PROPOSED · assistant";
  // Spec B15-FIXES-2: frozen issues never read as STALE.
  if (reviewStatus === "draft" && staleIds.includes(block.id)) {
    return "STALE · recompute";
  }
  if (block.proposal_state === "confirmed") return "CONFIRMED · was proposed";
  return "READY";
}

export function ReviewTabPanel({ clientUserId, dataThrough }: Props) {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingMetricId, setAddingMetricId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [draftKindTarget, setDraftKindTarget] = useState<DraftKind>("recommendation");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const lifecycleLocked = busy || pendingAction !== null;

  const base = `/api/operator/treasury/clients/${clientUserId}`;

  const loadReviews = useCallback(async () => {
    const qs = showArchived ? "?include_archived=1" : "";
    const res = await fetch(`${base}/reviews${qs}`);
    if (!res.ok) throw new Error("Failed to load reviews");
    const json = (await res.json()) as { reviews: ReviewItem[] };
    setReviews(json.reviews ?? []);
    return json.reviews ?? [];
  }, [base, showArchived]);

  const loadPreflight = useCallback(
    async (reviewId: string) => {
      const res = await fetch(`${base}/reviews/${reviewId}/preflight`);
      if (!res.ok) return;
      const json = (await res.json()) as { preflight?: Preflight };
      if (activeIdRef.current !== reviewId) return;
      if (json.preflight) setPreflight(json.preflight);
    },
    [base]
  );

  const loadReview = useCallback(
    async (reviewId: string, optimisticTitle?: string) => {
      activeIdRef.current = reviewId;
      setActiveId(reviewId);
      setLoadingId(reviewId);
      setBlocks([]);
      setPreflight(null);
      if (optimisticTitle !== undefined) setTitle(optimisticTitle);
      setError(null);
      try {
        const res = await fetch(`${base}/reviews/${reviewId}`);
        if (!res.ok) throw new Error("Failed to load review");
        const json = (await res.json()) as {
          review: { id: string; title: string; status: string };
          blocks: BlockItem[];
          preflight: Preflight;
        };
        if (activeIdRef.current !== reviewId) return;
        setTitle(json.review.title);
        setStatus(json.review.status);
        setBlocks(json.blocks);
        setPreflight(json.preflight);
        setLoadingId(null);
        // Spec B15-FIXES-2: skip deferred stale scan on frozen issues.
        if (json.review.status === "draft") void loadPreflight(reviewId);
      } catch (e) {
        if (activeIdRef.current !== reviewId) return;
        setLoadingId(null);
        setError(e instanceof Error ? e.message : "Load failed");
      }
    },
    [base, loadPreflight]
  );

  const loadMetrics = useCallback(async () => {
    const res = await fetch(`${base}/metrics`);
    if (!res.ok) return;
    const json = (await res.json()) as { metrics: MetricRow[] };
    setMetrics(json.metrics ?? []);
  }, [base]);

  const refresh = useCallback(
    async (preferId?: string | null) => {
      setError(null);
      try {
        const list = await loadReviews();
        const targetId = preferId ?? activeIdRef.current;
        const picked =
          (targetId ? list.find((r) => r.id === targetId) : null) ??
          list.find((r) => r.status === "draft") ??
          list[0];
        if (picked) await loadReview(picked.id, picked.title || picked.period_month);
        else {
          activeIdRef.current = null;
          setActiveId(null);
          setLoadingId(null);
          setBlocks([]);
          setPreflight(null);
        }
        await loadMetrics();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      }
    },
    [loadReviews, loadReview, loadMetrics]
  );

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    activeIdRef.current = null;
    void refreshRef.current();
  }, [clientUserId]);

  useEffect(() => {
    void refreshRef.current(activeIdRef.current);
  }, [showArchived]);

  function requestArchive(review: ReviewItem) {
    if (busy || pendingAction) return;
    setMenuOpenId(null);
    setConfirmTyped("");
    setPendingAction({ kind: "archive", review });
  }

  function requestDelete(review: ReviewItem) {
    if (busy || pendingAction) return;
    setMenuOpenId(null);
    setConfirmTyped("");
    setPendingAction({ kind: "delete", review });
  }

  function cancelPendingAction() {
    if (busy) return;
    setPendingAction(null);
    setConfirmTyped("");
  }

  async function confirmPendingAction() {
    if (!pendingAction || busy) return;
    const action = pendingAction;
    const review = action.review;
    const label = (review.title || review.period_month).trim();

    if (action.kind === "delete" && review.status === "published") {
      if (confirmTyped.trim() !== label) {
        setError("Delete cancelled — title did not match.");
        return;
      }
    }

    setBusy(true);
    setPendingAction(null);
    setConfirmTyped("");
    setError(null);
    try {
      if (action.kind === "archive") {
        const res = await fetch(`${base}/reviews/${review.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error ?? "Archive failed");
        }
        setError("Issue archived.");
        await refresh(activeId === review.id ? null : activeId);
      } else {
        const res = await fetch(`${base}/reviews/${review.id}?hard=1`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error ?? "Delete failed");
        }
        setError("Issue deleted.");
        await refresh(activeId === review.id ? null : activeId);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : action.kind === "archive"
            ? "Archive failed"
            : "Delete failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreReview(reviewId: string) {
    if (busy || pendingAction) return;
    setMenuOpenId(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Restore failed");
      }
      setError("Issue restored.");
      await refresh(reviewId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function discardMetric(metricId: string) {
    setBusy(true);
    setError(null);
    try {
      let res = await fetch(`${base}/metrics/${metricId}`, { method: "DELETE" });
      let json = (await res.json()) as {
        error?: string;
        references?: { draft_blocks: number; published_versions: number };
      };
      if (res.status === 409 && json.references) {
        const { draft_blocks, published_versions } = json.references;
        const ok = confirm(
          `This metric is used in ${draft_blocks} draft block(s) and ${published_versions} published version(s). Remove from library anyway?`
        );
        if (!ok) return;
        res = await fetch(`${base}/metrics/${metricId}?force=1`, {
          method: "DELETE",
        });
        json = (await res.json()) as typeof json;
      }
      if (!res.ok) throw new Error(json.error ?? "Discard failed");
      await loadMetrics();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setBusy(false);
    }
  }

  async function addExhibitToDraft(block: BlockItem) {
    if (!block.metric_id) return;
    setBusy(true);
    setError(null);
    try {
      const pickable: Pickable = {
        kind: "figure",
        ref: block.metric_id,
        label: block.metric_name ?? "Exhibit",
        params: {
          metric: block.metric_name ?? block.metric_id,
          from: "2000-01-01",
          to: new Date().toISOString().slice(0, 10),
        },
        snap: {
          label: block.metric_name ?? "Exhibit",
          name: block.metric_name ?? "Exhibit",
          snapshot: block.placed_snapshot ?? null,
        },
      };
      await postPickableToDraft(clientUserId, draftKindTarget, pickable);
      setError(`Cited in ${draftKindTarget} draft.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add to draft failed");
    } finally {
      setBusy(false);
    }
  }

  function presetFromPinned(pinned: unknown): PinnedWindowPreset | "" {
    if (!isPinnedWindow(pinned)) return "";
    return pinned.preset;
  }

  async function setBlockWindow(blockId: string, preset: PinnedWindowPreset | "") {
    if (!preset) {
      await patchBlock(blockId, { action: "set_window", window: null });
      return;
    }
    if (preset === "custom") {
      const start = prompt("Custom start (YYYY-MM-DD):");
      const end = prompt("Custom end (YYYY-MM-DD):");
      if (!start || !end) return;
      const window: PinnedWindow = { preset: "custom", start, end };
      await patchBlock(blockId, { action: "set_window", window });
      return;
    }
    await patchBlock(blockId, {
      action: "set_window",
      window: { preset } satisfies PinnedWindow,
    });
  }

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        review?: ReviewItem;
        existing?: ReviewItem;
        error?: string;
      };
      // Handled 409: open existing issue — success path, not an error.
      if (res.status === 409 && json.existing?.id) {
        await loadReview(
          json.existing.id,
          json.existing.title || json.existing.period_month
        );
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      await refresh(json.review?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    if (!activeId || status !== "draft") return;
    const res = await fetch(`${base}/reviews/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      throw new Error(json.error ?? `Title save failed (${res.status})`);
    }
  }

  async function addMetricBlock(
    metric: MetricRow,
    role: "figure" | "exhibit",
    viewMode?: "chart" | "table"
  ) {
    if (!activeId || addingMetricId) return;
    setAddingMetricId(metric.id);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews/${activeId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, metric_id: metric.id }),
      });
      const json = (await res.json()) as {
        error?: string;
        block?: { id: string };
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Add failed");
      }
      if (role === "exhibit" && viewMode === "table" && json.block?.id) {
        await patchBlock(json.block.id, {
          action: "set_view_mode",
          view_mode: "table",
        });
      } else {
        await loadReview(activeId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAddingMetricId(null);
    }
  }

  async function addNote() {
    if (!activeId) return;
    const body = prompt("Note body:");
    if (!body?.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/reviews/${activeId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "note", body: body.trim() }),
      });
      if (!res.ok) throw new Error("Add note failed");
      await loadReview(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add note failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchBlock(blockId: string, payload: Record<string, unknown>) {
    if (!activeId) return;
    const res = await fetch(`${base}/reviews/${activeId}/blocks/${blockId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? "Update failed");
    }
    await loadReview(activeId);
  }

  async function publish() {
    if (!activeId) return;
    if (!confirm("Publish this review to the client?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews/${activeId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { error?: string; preflight?: Preflight };
      if (!res.ok) {
        if (json.preflight) setPreflight(json.preflight);
        throw new Error(
          json.error
            ? `${json.error} (${res.status})`
            : `Publish failed (${res.status})`
        );
      }
      await refresh(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  const publishBlocked =
    !preflight ||
    preflight.proposed_count > 0 ||
    preflight.stale_count > 0 ||
    preflight.envelope_violations.length > 0;

  const gateLevel =
    status !== "draft"
      ? "ready"
      : blocks.length === 0
        ? "quiet"
        : publishBlocked
          ? "blocked"
          : "ready";

  const activeReview = reviews.find((r) => r.id === activeId);
  const nextVersion = (activeReview?.current_version ?? 0) + 1;
  // Spec B15-FIXES-2: never surface stale ids on frozen issues.
  const staleIds =
    status === "draft" ? (preflight?.stale_block_ids ?? []) : [];
  const isLoadingIssue = Boolean(loadingId && loadingId === activeId);
  const pendingLabel = pendingAction
    ? (pendingAction.review.title || pendingAction.review.period_month).trim()
    : "";
  const publishedDeleteNeedsType =
    pendingAction?.kind === "delete" &&
    pendingAction.review.status === "published";
  const pendingConfirmReady =
    pendingAction != null &&
    (!publishedDeleteNeedsType || confirmTyped.trim() === pendingLabel);

  const openShelfFor = (role: "figure" | "exhibit") => {
    setShelfOpen(true);
    setError(
      role === "figure"
        ? "Pick a value metric from the Shelf → Figure."
        : "Pick an analytics metric from the Shelf → Exhibit."
    );
  };

  return (
    <div
      className="rcx-stage"
      data-shelf={shelfOpen ? "open" : "collapsed"}
      data-builder={builderOpen ? "open" : "closed"}
      onClick={() => {
        if (menuOpenId) setMenuOpenId(null);
      }}
    >
      <style>{RCX_CSS}</style>

      {/* ── Issues rail ─────────────────────────────── */}
      <aside className="rcx-rail">
        <div className="rcx-kick">Issues</div>
        <label
          className="rcx-muted"
          style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginBottom: 6 }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {reviews.map((r) => (
          <div
            key={r.id}
            className={`rcx-issue-row${activeId === r.id ? " on" : ""}`}
            style={{ display: "flex", gap: 4, alignItems: "stretch", position: "relative" }}
          >
            <button
              type="button"
              className={`rcx-issue${activeId === r.id ? " on" : ""}`}
              style={{ flex: 1 }}
              onClick={() =>
                void loadReview(r.id, r.title || r.period_month)
              }
            >
              <div className="t">{r.title || r.period_month}</div>
              <div className="m">
                {r.status}
                {r.current_version ? ` · v${r.current_version}` : ""}
                {r.reply_count ? ` · ${r.reply_count} replies` : ""}
              </div>
            </button>
            <div style={{ position: "relative", alignSelf: "center" }}>
              <button
                type="button"
                className="rcx-tool"
                title="Issue actions"
                disabled={lifecycleLocked}
                aria-expanded={menuOpenId === r.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (lifecycleLocked) return;
                  setMenuOpenId((cur) => (cur === r.id ? null : r.id));
                }}
              >
                ⋯
              </button>
              {menuOpenId === r.id ? (
                <div
                  className="rcx-menu"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    zIndex: 20,
                    background: "var(--su-paper, #FCFBF9)",
                    border: "1px solid var(--su-line, #DED9D1)",
                    minWidth: 120,
                    padding: 4,
                    boxShadow: "0 4px 12px rgba(0,0,0,.08)",
                  }}
                >
                  {r.status === "archived" ? (
                    <button
                      type="button"
                      className="rcx-tool"
                      style={{ display: "block", width: "100%", textAlign: "left" }}
                      role="menuitem"
                      disabled={lifecycleLocked}
                      onClick={() => void restoreReview(r.id)}
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rcx-tool"
                      style={{ display: "block", width: "100%", textAlign: "left" }}
                      role="menuitem"
                      disabled={lifecycleLocked}
                      onClick={() => requestArchive(r)}
                    >
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    className="rcx-tool danger"
                    style={{ display: "block", width: "100%", textAlign: "left" }}
                    role="menuitem"
                    disabled={lifecycleLocked}
                    onClick={() => requestDelete(r)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="rcx-btn ghost sm rcx-new"
          disabled={busy}
          onClick={() => void createDraft()}
        >
          + New draft issue
        </button>
      </aside>

      {/* ── Document (centre) ───────────────────────── */}
      <section className="rcx-doc">
        <div className="rcx-gate" data-level={gateLevel}>
          <span className="gt">{title || "Draft issue"}</span>
          <span className={`gc${gateLevel === "blocked" ? " warn" : ""}`}>
            {preflight
              ? `Proposed ${preflight.proposed_count} · Stale ${preflight.stale_count} · Envelope ${preflight.envelope_violations.length}`
              : activeId
                ? "Loading preflight…"
                : "No draft issue"}
          </span>
          <span className="spacer" />
          <span className="hint">
            {gateLevel === "quiet"
              ? "Nothing to publish yet"
              : publishBlocked
                ? "Clean the preflight to publish"
                : status === "draft"
                  ? `Preflight clean · freezes ${blocks.length} blocks`
                  : "Published"}
          </span>
          <button
            type="button"
            className={`rcx-btn sm${gateLevel === "ready" && status === "draft" ? "" : " ghost"}`}
            disabled={busy || status !== "draft" || publishBlocked}
            onClick={() => void publish()}
          >
            {status === "draft" ? `Publish v${nextVersion}` : "Published"}
          </button>
        </div>

        {preflight?.envelope_violations.length ? (
          <ul className="rcx-viol">
            {preflight.envelope_violations.map((v, i) => (
              <li key={i}>
                {v.field}: {v.message}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="rcx-err" role="alert">
            {error}
          </p>
        ) : null}

        {!activeId ? (
          <div className="rcx-paper">
            <p className="rcx-muted">Create or select a draft issue to begin.</p>
          </div>
        ) : isLoadingIssue ? (
          <div className="rcx-paper">
            <div className="rcx-cover">
              <div className="ct">{title || "Issue"}</div>
              <div className="cs">Loading…</div>
            </div>
            <p className="rcx-muted" style={{ padding: "24px 0" }}>
              Loading {title || "issue"}…
            </p>
          </div>
        ) : (
          <div className="rcx-paper">
            <div className="rcx-cover">
              <input
                className="ct"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  void saveTitle().catch((e) =>
                    setError(e instanceof Error ? e.message : "Title save failed")
                  );
                }}
              />
              <div className="cs">
                {status === "draft" ? "Draft" : status.toUpperCase()}
                {activeReview?.current_version
                  ? ` · v${activeReview.current_version}`
                  : ""}
              </div>
            </div>

            {status === "draft" && blocks.length === 0 ? (
              <div className="rcx-empty">
                <div className="et">Nothing placed yet</div>
                <div className="eh">Start your {title || "review"}</div>
                <div className="ep">
                  Add a Figure, an Exhibit, or a Note. Everything you place stays on
                  this side until you publish.
                </div>
                <div className="rcx-ecards">
                  <button
                    type="button"
                    className="rcx-ecard"
                    onClick={() => openShelfFor("figure")}
                  >
                    Add a Figure
                  </button>
                  <button
                    type="button"
                    className="rcx-ecard"
                    onClick={() => openShelfFor("exhibit")}
                  >
                    Add an Exhibit
                  </button>
                  <button
                    type="button"
                    className="rcx-ecard"
                    onClick={() => void addNote()}
                  >
                    Write a Note
                  </button>
                </div>
              </div>
            ) : null}

            {blocks.map((block) => {
              const isProposed = block.proposal_state === "proposed";
              const isStale = staleIds.includes(block.id);
              const isStudy = block.role === "study";
              const hasMetric =
                block.role === "figure" || block.role === "exhibit";
              const viewMode = block.view_mode === "table" ? "table" : "chart";
              const studySnap = isPlacedStudySnapshot(block.placed_snapshot)
                ? block.placed_snapshot
                : null;
              return (
                <article
                  key={block.id}
                  className="rcx-block"
                  data-gate={isProposed ? "proposed" : isStale ? "stale" : undefined}
                >
                  <div className="rcx-bchrome">
                    <span className="rcx-chip rcx-role">{block.role}</span>
                    <span className="rcx-chip" data-state={stateChip(block, staleIds, status)}>
                      {stateChip(block, staleIds, status)}
                    </span>
                    {block.metric_name || studySnap?.name ? (
                      <span className="rcx-src">
                        {block.metric_name ?? studySnap?.name}
                      </span>
                    ) : (
                      <span className="rcx-src" />
                    )}
                    <div className="rcx-tools">
                      {isProposed ? (
                        <button
                          type="button"
                          className="rcx-tool primary"
                          onClick={() =>
                            void patchBlock(block.id, {
                              action: "confirm_proposal",
                            }).catch((e) => setError(String(e.message)))
                          }
                        >
                          Confirm proposal
                        </button>
                      ) : null}
                      {(hasMetric || isStudy) && (block.role === "exhibit" || isStudy) ? (
                        <div
                          className="rcx-seg"
                          role="group"
                          aria-label="View mode"
                          style={{
                            display: "inline-flex",
                            border: "1px solid var(--su-line, #DED9D1)",
                            borderRadius: 4,
                            overflow: "hidden",
                          }}
                        >
                          <button
                            type="button"
                            className="rcx-tool"
                            disabled={status !== "draft"}
                            style={{
                              borderRadius: 0,
                              border: "none",
                              background:
                                viewMode === "chart"
                                  ? "var(--su-line, #DED9D1)"
                                  : "transparent",
                            }}
                            onClick={() =>
                              void patchBlock(block.id, {
                                action: "set_view_mode",
                                view_mode: "chart",
                              }).catch((e) => setError(String(e.message)))
                            }
                          >
                            Chart
                          </button>
                          <button
                            type="button"
                            className="rcx-tool"
                            disabled={status !== "draft"}
                            style={{
                              borderRadius: 0,
                              border: "none",
                              background:
                                viewMode === "table"
                                  ? "var(--su-line, #DED9D1)"
                                  : "transparent",
                            }}
                            onClick={() =>
                              void patchBlock(block.id, {
                                action: "set_view_mode",
                                view_mode: "table",
                              }).catch((e) => setError(String(e.message)))
                            }
                          >
                            Table
                          </button>
                        </div>
                      ) : null}
                      {hasMetric && block.role === "exhibit" ? (
                        <select
                          className="rcx-tool"
                          disabled={status !== "draft"}
                          value={presetFromPinned(block.pinned_window)}
                          onChange={(e) =>
                            void setBlockWindow(
                              block.id,
                              e.target.value as PinnedWindowPreset | ""
                            ).catch((err) => setError(String(err.message)))
                          }
                          title="Date window"
                        >
                          <option value="">Window: metric default</option>
                          {PINNED_WINDOW_PRESETS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {hasMetric ? (
                        <button
                          type="button"
                          className="rcx-tool"
                          disabled={busy}
                          onClick={() => void addExhibitToDraft(block)}
                        >
                          ＋ Add to draft
                        </button>
                      ) : null}
                      {hasMetric || isStudy ? (
                        <button
                          type="button"
                          className={`rcx-tool${isStale ? " primary" : ""}`}
                          disabled={busy || status !== "draft"}
                          onClick={() =>
                            void patchBlock(block.id, {
                              action: "recalculate",
                            })
                              .then(() => {
                                if (activeId && status === "draft") {
                                  void loadPreflight(activeId);
                                }
                              })
                              .catch((e) => setError(String(e.message)))
                          }
                        >
                          {isStale ? "Recompute" : "Recalculate"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rcx-tool danger"
                        onClick={() => {
                          if (!confirm("Remove block?")) return;
                          void fetch(
                            `${base}/reviews/${activeId}/blocks/${block.id}`,
                            { method: "DELETE" }
                          ).then(() => loadReview(activeId!));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {block.role === "note" ? (
                    <p className="rcx-note">{block.body}</p>
                  ) : null}

                  {isStudy ? (
                    <StudyBlockView
                      snapshot={block.placed_snapshot}
                      viewMode={viewMode}
                      showProvenance
                    />
                  ) : null}

                  {block.role === "exhibit" &&
                  (block.placed_snapshot as { comparison?: MetricComparison } | null)
                    ?.comparison?.v === 3 ? (
                    <div className="rcx-chart">
                      {viewMode === "table" ? (
                        <MetricComparisonTable
                          comparison={
                            (block.placed_snapshot as { comparison: MetricComparison })
                              .comparison
                          }
                        />
                      ) : (
                        <MetricComparisonChart
                          comparison={
                            (block.placed_snapshot as { comparison: MetricComparison })
                              .comparison
                          }
                          height={210}
                        />
                      )}
                    </div>
                  ) : null}
                  {block.role === "exhibit" &&
                  (
                    block.placed_snapshot as {
                      series?: { points?: unknown[] };
                    } | null
                  )?.series?.points?.length ? (
                    <div className="rcx-chart">
                      {viewMode === "table" ? (
                        <MetricSeriesTable
                          points={
                            (
                              block.placed_snapshot as {
                                series: {
                                  points: {
                                    bucket_start: string;
                                    bucket_label: string;
                                    value: number;
                                    partial?: true;
                                  }[];
                                  reference_lines?: {
                                    id: string;
                                    label: string;
                                    value: number;
                                    kind: string;
                                  }[];
                                };
                              }
                            ).series.points
                          }
                          referenceLines={
                            (
                              block.placed_snapshot as {
                                series: {
                                  reference_lines?: {
                                    id: string;
                                    label: string;
                                    value: number;
                                    kind: string;
                                  }[];
                                };
                              }
                            ).series.reference_lines ?? []
                          }
                        />
                      ) : (
                        <MetricChart
                          points={
                            (
                              block.placed_snapshot as {
                                series: {
                                  points: {
                                    bucket_start: string;
                                    bucket_label: string;
                                    value: number;
                                  }[];
                                  reference_lines?: {
                                    id: string;
                                    label: string;
                                    value: number;
                                    kind: string;
                                  }[];
                                  chart_hint?: string;
                                };
                              }
                            ).series.points
                          }
                          referenceLines={
                            (
                              block.placed_snapshot as {
                                series: {
                                  reference_lines?: {
                                    id: string;
                                    label: string;
                                    value: number;
                                    kind: string;
                                  }[];
                                };
                              }
                            ).series.reference_lines ?? []
                          }
                          chartHint={
                            (
                              block.placed_snapshot as {
                                series: { chart_hint?: string };
                              }
                            ).series.chart_hint === "line"
                              ? "line"
                              : "column"
                          }
                          height={210}
                        />
                      )}
                    </div>
                  ) : null}
                  {block.role === "figure" &&
                  typeof (block.placed_snapshot as { value?: number } | null)
                    ?.value === "number" ? (
                    <div className="rcx-figval">
                      {(
                        block.placed_snapshot as { value: number }
                      ).value.toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  ) : null}
                  {hasMetric || isStudy ? (
                    <div className="rcx-caprow">
                      <span className="rcx-caplbl">Caption</span>
                      <textarea
                        className="rcx-cap"
                        rows={2}
                        value={block.caption}
                        placeholder={block.suggested_caption ?? ""}
                        onChange={(e) =>
                          setBlocks((prev) =>
                            prev.map((b) =>
                              b.id === block.id
                                ? { ...b, caption: e.target.value }
                                : b
                            )
                          )
                        }
                        onBlur={() =>
                          void patchBlock(block.id, {
                            caption: block.caption,
                          }).catch((e) => setError(String(e.message)))
                        }
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}

            {status === "draft" ? (
              <div className="rcx-drafts-wrap" style={{ marginTop: 16 }}>
                <ReviewDraftsPanel
                  clientUserId={clientUserId}
                  draftKindTarget={draftKindTarget}
                  onDraftKindChange={setDraftKindTarget}
                />
              </div>
            ) : null}

            {status === "draft" ? (
              <div className="rcx-addbar">
                <span className="al">Add</span>
                <button
                  type="button"
                  className="rcx-tool"
                  onClick={() => openShelfFor("figure")}
                >
                  + Figure
                </button>
                <button
                  type="button"
                  className="rcx-tool"
                  onClick={() => openShelfFor("exhibit")}
                >
                  + Exhibit
                </button>
                <button
                  type="button"
                  className="rcx-tool"
                  onClick={() => void addNote()}
                >
                  + Note
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Shelf (right drawer) ────────────────────── */}
      <button
        type="button"
        className="rcx-shelf-mini"
        onClick={() => setShelfOpen(true)}
      >
        The Shelf · {metrics.length}
      </button>
      {shelfOpen ? (
        <>
          <div className="rcx-shelf-scrim" onClick={() => setShelfOpen(false)} />
          <aside className="rcx-shelf">
          <div className="sh">
            <span className="st">The Shelf</span>
            <button
              type="button"
              className="rcx-tool"
              aria-label="Collapse shelf"
              onClick={() => setShelfOpen(false)}
            >
              ›
            </button>
          </div>
          <div style={{ marginBottom: 16 }}>
            <StudiesPanel
              clientUserId={clientUserId}
              reviewId={activeId}
              reviewStatus={status}
              busy={busy}
              onPlaced={() => {
                if (activeId) void loadReview(activeId);
              }}
              onError={setError}
            />
          </div>
          <div className="rcx-kick" style={{ marginTop: 8 }}>
            Metrics
          </div>
          <div className="rcx-kick" style={{ margin: "8px 0 2px", fontSize: 10 }}>
            Metric library · {metrics.length}
          </div>
          <div className="rcx-slist">
            {metrics.map((m) => (
              <div key={m.id} className="rcx-sitem">
                <div className="sn">{m.name}</div>
                <div className="sk">
                  {m.kind === "value"
                    ? "Value"
                    : m.kind === "comparison"
                      ? "Comparison"
                      : "Analytics"}
                </div>
                <div className="sb">
                  <button
                    type="button"
                    className="rcx-tool"
                    disabled={status !== "draft" || !!addingMetricId}
                    onClick={() => void addMetricBlock(m, "figure")}
                  >
                    Figure
                  </button>
                  {m.kind !== "value" ? (
                    <>
                      <button
                        type="button"
                        className="rcx-tool"
                        disabled={status !== "draft" || !!addingMetricId}
                        onClick={() => void addMetricBlock(m, "exhibit")}
                      >
                        Exhibit
                      </button>
                      <button
                        type="button"
                        className="rcx-tool"
                        disabled={status !== "draft" || !!addingMetricId}
                        onClick={() =>
                          void addMetricBlock(m, "exhibit", "table")
                        }
                      >
                        As table
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="rcx-tool danger"
                    disabled={busy}
                    onClick={() => void discardMetric(m.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {metrics.length === 0 ? (
              <p className="rcx-muted" style={{ fontSize: 12 }}>
                No metrics yet. Build one below.
              </p>
            ) : null}
          </div>
          <div className="rcx-sfoot">
            <button
              type="button"
              className="rcx-btn sm"
              style={{ width: "100%" }}
              onClick={() => setBuilderOpen(true)}
            >
              + New metric
            </button>
            <p className="rcx-muted" style={{ fontSize: 11, marginTop: 6 }}>
              Opens the builder full-width. Never client-visible.
            </p>
          </div>
          </aside>
        </>
      ) : null}

      {/* ── Metric builder (slide-over) ─────────────── */}
      {builderOpen ? (
        <>
          <div className="rcx-scrim" onClick={() => setBuilderOpen(false)} />
          <aside
            className="rcx-builder"
            role="dialog"
            aria-modal="true"
            aria-label="Metric builder"
          >
            <div className="bh">
              <div>
                <div className="bk">The Shelf · Metric builder</div>
                <div className="bt">New metric</div>
              </div>
              <button
                type="button"
                className="bx"
                aria-label="Close builder"
                onClick={() => setBuilderOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="rcx-bbody">
              <MetricsTab clientUserId={clientUserId} dataThrough={dataThrough} />
            </div>
          </aside>
        </>
      ) : null}

      {/* ── Lifecycle confirm (single-owner) ────────── */}
      {pendingAction ? (
        <>
          <div
            className="rcx-scrim"
            onClick={() => cancelPendingAction()}
          />
          <div
            className="rcx-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rcx-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rcx-kick" id="rcx-confirm-title">
              {pendingAction.kind === "archive" ? "Archive issue" : "Delete issue"}
            </div>
            <p className="rcx-confirm-body">
              {pendingAction.kind === "archive"
                ? `Archive “${pendingLabel}”? Published issues leave the client view; versions are retained.`
                : publishedDeleteNeedsType
                  ? `This issue is published — the client will lose it permanently. Type the issue title to confirm.`
                  : `Permanently delete “${pendingLabel}”? This cannot be undone.`}
            </p>
            {publishedDeleteNeedsType ? (
              <label className="rcx-confirm-label">
                <span className="rcx-muted" style={{ fontSize: 11 }}>
                  Type “{pendingLabel}”
                </span>
                <input
                  className="rcx-confirm-input"
                  value={confirmTyped}
                  autoFocus
                  onChange={(e) => setConfirmTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && pendingConfirmReady) {
                      void confirmPendingAction();
                    }
                  }}
                />
              </label>
            ) : null}
            <div className="rcx-confirm-actions">
              <button
                type="button"
                className="rcx-btn ghost sm"
                disabled={busy}
                onClick={() => cancelPendingAction()}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`rcx-btn sm${pendingAction.kind === "delete" ? " danger" : ""}`}
                disabled={busy || !pendingConfirmReady}
                onClick={() => void confirmPendingAction()}
              >
                {pendingAction.kind === "archive" ? "Archive" : "Delete"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const RCX_CSS = `
.rcx-stage{display:grid;gap:20px;margin:0;padding:2px 2px 48px;align-items:start;grid-template-columns:196px minmax(0,1fr) 46px;font-family:var(--font-ui,'Arimo',Arial,sans-serif);color:var(--ink)}
@media(max-width:820px){.rcx-stage{grid-template-columns:1fr}}
.rcx-muted{color:var(--mute);font-size:13px}
.rcx-kick{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-bottom:10px}
/* rail */
.rcx-rail{position:sticky;top:8px}
.rcx-issue{display:block;width:100%;text-align:left;border:1px solid transparent;border-radius:9px;padding:9px 11px;margin-bottom:4px;background:transparent;cursor:pointer;font:inherit;color:var(--ink)}
.rcx-issue:hover{background:color-mix(in srgb,var(--canvas-2) 55%,transparent)}
.rcx-issue.on{background:var(--rail,#fff);border-color:var(--paper-edge);box-shadow:var(--paper-shadow)}
.rcx-issue .t{font-size:13px;font-weight:600;line-height:1.25}
.rcx-issue .m{font-size:11px;color:var(--mute);margin-top:3px;text-transform:capitalize;letter-spacing:.02em}
.rcx-new{margin-top:8px}
/* gate */
.rcx-gate{position:sticky;top:8px;z-index:5;min-height:40px;display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;border-radius:9px;padding:8px 14px;margin-bottom:14px;font-size:13px;border:1px solid transparent;transition:background .15s,border-color .15s}
.rcx-gate[data-level="quiet"]{background:transparent;opacity:.8}
.rcx-gate[data-level="blocked"]{background:var(--rail,#fff);border-color:var(--paper-edge);box-shadow:var(--paper-shadow)}
.rcx-gate[data-level="ready"]{background:color-mix(in srgb,var(--su-accept,#174a7a) 8%,var(--rail,#fff));border-color:color-mix(in srgb,var(--su-accept,#174a7a) 38%,var(--line))}
.rcx-gate .gt{font-weight:600}
.rcx-gate .gc{font-size:12px;color:var(--mute)}
.rcx-gate .gc.warn{color:var(--su-warn-ink)}
.rcx-gate .spacer{flex:1 1 auto}
.rcx-gate .hint{font-size:11.5px;color:var(--mute)}
.rcx-gate[data-level="ready"] .hint{color:var(--su-accept)}
.rcx-viol{list-style:none;margin:0 0 12px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--su-warn,#c8881f) 8%,#fff);border:1px solid color-mix(in srgb,var(--su-warn,#c8881f) 30%,var(--line));font-size:12px;color:var(--su-warn-ink)}
.rcx-err{background:color-mix(in srgb,var(--su-neg,#b23a2e) 7%,#fff);border:1px solid color-mix(in srgb,var(--su-neg,#b23a2e) 28%,var(--line));color:var(--su-neg);border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:14px}
/* paper */
.rcx-doc{min-width:0}
.rcx-paper{max-width:960px;margin:0 auto;background:var(--paper,#fff);border:1px solid var(--paper-edge);border-radius:12px;box-shadow:var(--paper-shadow);padding:28px 36px}
.rcx-cover .ct{font-size:26px;font-weight:700;letter-spacing:-.01em;border:none;outline:none;width:100%;background:transparent;color:var(--ink);font-family:inherit;padding:0}
.rcx-cover .cs{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-top:5px}
.rcx-block{border-top:1px dashed var(--canvas-2);padding:18px 0 2px;margin-top:20px}
.rcx-block[data-gate="proposed"] .rcx-cap{background:color-mix(in srgb,var(--su-await,#3e6e8e) 7%,#fff);border-color:color-mix(in srgb,var(--su-await,#3e6e8e) 30%,var(--line))}
.rcx-bchrome{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-bottom:10px}
.rcx-src{font-size:12px;color:var(--mute);flex:1 1 220px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcx-tools{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px}
.rcx-caprow{margin-top:2px}
.rcx-caplbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;display:block;margin-bottom:5px}
.rcx-cap{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:13.5px;line-height:1.5;color:var(--ink);background:color-mix(in srgb,var(--canvas,#eef3f9) 40%,#fff);resize:vertical;min-height:54px}
.rcx-cap:focus{outline:none;border-color:var(--brand);background:#fff}
.rcx-note{font-size:14px;line-height:1.55;white-space:pre-wrap;color:var(--slate)}
.rcx-chart{margin:6px 0 12px;max-width:660px}
.rcx-chart svg{max-width:100%;height:auto}
.rcx-figval{font-size:28px;font-weight:700;color:var(--ink);letter-spacing:-.01em;margin:2px 0 8px}
/* chips + buttons */
.rcx-chip{display:inline-flex;align-items:center;font-size:10px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;border-radius:999px;padding:3px 9px;background:var(--canvas-2);color:var(--slate);border:none}
.rcx-role{background:var(--brand);color:#fff}
.rcx-chip[data-state="READY"]{background:color-mix(in srgb,var(--su-accept,#174a7a) 12%,transparent);color:var(--su-accept)}
.rcx-chip[data-state^="PROPOSED"]{background:color-mix(in srgb,var(--su-await,#3e6e8e) 15%,transparent);color:var(--su-await)}
.rcx-chip[data-state^="CONFIRMED"]{background:color-mix(in srgb,var(--su-accept,#174a7a) 12%,transparent);color:var(--su-accept)}
.rcx-tool{font:inherit;font-size:12px;font-weight:600;border:1px solid var(--line);background:#fff;color:var(--slate);border-radius:7px;padding:5px 11px;cursor:pointer;line-height:1.3}
.rcx-tool:hover:not(:disabled){border-color:var(--brand-2);color:var(--brand)}
.rcx-tool:disabled{opacity:.45;cursor:not-allowed}
.rcx-tool.primary{background:var(--brand);border-color:var(--brand);color:#fff}
.rcx-tool.primary:hover{filter:brightness(1.06);color:#fff}
.rcx-tool.danger:hover{border-color:var(--su-neg);color:var(--su-neg)}
.rcx-btn{font:inherit;font-size:13px;font-weight:700;border-radius:8px;padding:8px 15px;cursor:pointer;border:1px solid var(--brand);background:var(--brand);color:#fff}
.rcx-btn.ghost{background:#fff;color:var(--brand)}
.rcx-btn.sm{padding:6px 12px;font-size:12.5px}
.rcx-btn:disabled{opacity:.5;cursor:not-allowed}
/* empty */
.rcx-empty{border:1px dashed var(--canvas-2);border-radius:11px;background:color-mix(in srgb,var(--canvas,#eef3f9) 50%,transparent);padding:30px 24px;text-align:center;margin-top:20px}
.rcx-empty .et{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}
.rcx-empty .eh{font-size:20px;font-weight:700;margin:7px 0 7px;color:var(--ink)}
.rcx-empty .ep{font-size:13px;color:var(--slate);max-width:440px;margin:0 auto 18px;line-height:1.5}
.rcx-ecards{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.rcx-ecard{border:1px solid var(--paper-edge);background:#fff;border-radius:9px;padding:12px 20px;font-weight:600;font-size:13px;color:var(--brand);cursor:pointer}
.rcx-ecard:hover{border-color:var(--brand);box-shadow:var(--paper-shadow)}
.rcx-addbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-top:1px dashed var(--canvas-2);margin-top:22px;padding-top:16px}
.rcx-addbar .al{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-right:2px}
/* shelf */
.rcx-shelf-scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--ink,#102a47) 28%,transparent);z-index:60;animation:rcxfade .18s ease}
.rcx-shelf{position:fixed;top:0;right:0;bottom:0;width:min(348px,92vw);z-index:61;background:var(--rail,#fff);border-left:1px solid var(--paper-edge);box-shadow:-18px 0 54px rgba(16,42,71,.18);padding:16px 16px;display:flex;flex-direction:column;overflow:auto;animation:rcxslide .2s ease}
.rcx-shelf .sh{display:flex;align-items:center;justify-content:space-between}
.rcx-shelf .st{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}
.rcx-slist{overflow:auto;margin:6px -2px;padding:2px;display:flex;flex-direction:column;gap:8px;flex:1 1 auto}
.rcx-sitem{border:1px solid var(--paper-edge);border-radius:9px;padding:9px 10px;background:#fff}
.rcx-sitem .sn{font-size:13px;font-weight:600;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcx-sitem .sk{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-top:2px}
.rcx-sitem .sb{display:flex;gap:6px;margin-top:9px}
.rcx-sfoot{margin-top:10px;padding-top:12px;border-top:1px solid var(--line)}
.rcx-shelf-mini{writing-mode:vertical-rl;transform:rotate(180deg);cursor:pointer;background:var(--rail,#fff);border:1px solid var(--paper-edge);border-radius:10px;box-shadow:var(--paper-shadow);padding:16px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--slate);height:220px;align-self:start}
/* builder slide-over */
.rcx-scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--ink,#102a47) 35%,transparent);z-index:60;animation:rcxfade .18s ease}
.rcx-builder{position:fixed;top:0;right:0;bottom:0;width:min(860px,94vw);background:var(--paper,#fff);box-shadow:-18px 0 54px rgba(16,42,71,.20);z-index:61;display:flex;flex-direction:column;overflow:hidden;animation:rcxslide .22s ease}
.rcx-builder .bh{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line);background:var(--paper,#fff);flex:0 0 auto}
.rcx-builder .bh .bt{font-size:17px;font-weight:700;color:var(--ink)}
.rcx-builder .bh .bk{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700}
.rcx-builder .bx{font-size:22px;line-height:1;border:none;background:transparent;cursor:pointer;color:var(--mute);padding:2px 8px}
.rcx-builder .bx:hover{color:var(--ink)}
.rcx-bbody{padding:18px 22px;overflow:auto;flex:1 1 auto}
.rcx-confirm{position:fixed;left:50%;top:28%;transform:translateX(-50%);z-index:70;width:min(420px,92vw);background:var(--su-paper,#FCFBF9);border:1px solid var(--su-line,#DED9D1);border-radius:10px;box-shadow:0 12px 40px rgba(16,42,71,.18);padding:18px 20px;animation:rcxfade .16s ease}
.rcx-confirm-body{font-size:13.5px;line-height:1.5;color:var(--ink);margin:8px 0 14px}
.rcx-confirm-label{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.rcx-confirm-input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;color:var(--ink);background:#fff}
.rcx-confirm-input:focus{outline:none;border-color:var(--brand)}
.rcx-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.rcx-btn.danger{background:var(--su-neg,#B42318);border-color:var(--su-neg,#B42318);color:#fff}
@keyframes rcxslide{from{transform:translateX(40px);opacity:.4}to{transform:translateX(0);opacity:1}}
@keyframes rcxfade{from{opacity:0}to{opacity:1}}
`;
