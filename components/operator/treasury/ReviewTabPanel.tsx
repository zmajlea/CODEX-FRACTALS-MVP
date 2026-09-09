"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { MetricsTab } from "@/components/operator/treasury/analytics/MetricsTab";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import { MetricComparisonChart } from "@/components/operator/treasury/analytics/MetricComparisonChart";
import {
  MetricComparisonTable,
  MetricSeriesTable,
} from "@/components/operator/treasury/analytics/MetricTable";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { StudiesPanel } from "@/components/operator/treasury/StudiesPanel";
import { ModelStudio } from "@/components/operator/treasury/ModelStudio";
import { StudyBlockView } from "@/components/operator/treasury/StudyBlockView";
import type { MetricComparison } from "@/lib/treasury/metrics-eval";
import { isPlacedStudySnapshot } from "@/lib/treasury/study-assemble";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import {
  PINNED_WINDOW_PRESETS,
  type PinnedWindow,
  type PinnedWindowPreset,
  isPinnedWindow,
} from "@/lib/treasury/pinned-window";
import {
  LAYOUT_PRESETS,
  gridColumnSpan,
  renderMetricAsChart,
  resolveLayout,
  showChartTableToggle,
  snapshotHasSeries,
  summaryValueFromSnapshot,
  type ReviewBlockLayout,
} from "@/lib/treasury/review-block-layout";

type StudyDateWindow = { from: string; to: string };

type EditionMeta = {
  id: string;
  version: number;
  reviewed_as_of?: string;
  published_at: string | null;
  change_note?: string | null;
  label: string | null;
  window: StudyDateWindow | null;
};

function defaultStudyWindow(now = new Date()): StudyDateWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  const end = new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
  const start = new Date(Date.UTC(y, m - 11, 1)).toISOString().slice(0, 10);
  return { from: start, to: end };
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Spec B19-C2 — read-only OB from a placed Model block snapshot. */
function openingBalanceFromBlocks(
  blocks: Array<{ role: string; placed_snapshot?: Record<string, unknown> | null }>
): { value: number; source: string } | null {
  for (const b of blocks) {
    if (b.role !== "study" || !b.placed_snapshot) continue;
    const ob = b.placed_snapshot.opening_balance;
    if (typeof ob === "number" && Number.isFinite(ob)) {
      const src = String(b.placed_snapshot.opening_balance_source ?? "ledger");
      return { value: ob, source: src };
    }
  }
  return null;
}

type ReviewItem = {
  id: string;
  title: string;
  period_month: string;
  status: string;
  current_version: number;
  reply_count?: number;
  window?: StudyDateWindow | null;
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
  layout?: ReviewBlockLayout | null;
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
  client_user_id?: string | null;
};

type Props = {
  clientUserId: string;
  dataThrough?: string | null;
  /** Spec B23 — pick into DraftsRail (recommendation / question). */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
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

export function ReviewTabPanel({ clientUserId, dataThrough, onPick }: Props) {
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
  const [studioOpen, setStudioOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [addingMetricId, setAddingMetricId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");
  const [canvasBp, setCanvasBp] = useState<"desktop" | "tablet" | "phone">(
    "desktop"
  );
  /** Spec B19 — Study live from–to (drives preview; default trailing-12 when empty). */
  const [windowFrom, setWindowFrom] = useState("");
  const [windowTo, setWindowTo] = useState("");
  const [previewAsClient, setPreviewAsClient] = useState(false);
  const [clientPreview, setClientPreview] = useState<{
    meta: { title: string; reviewed_as_of: string; version: number };
    cover_figures: Array<{ label: string; value: number | string; caption?: string }>;
    blocks: Array<Record<string, unknown>>;
  } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [editionLabel, setEditionLabel] = useState("");
  const [publishFrom, setPublishFrom] = useState("");
  const [publishTo, setPublishTo] = useState("");
  /** Spec B19-C2 — published Editions for the selected Study (latest first). */
  const [editions, setEditions] = useState<EditionMeta[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
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
      setEditions([]);
      setClientPreview(null);
      if (optimisticTitle !== undefined) setTitle(optimisticTitle);
      setError(null);
      try {
        const res = await fetch(`${base}/reviews/${reviewId}`);
        if (!res.ok) throw new Error("Failed to load review");
        const json = (await res.json()) as {
          review: {
            id: string;
            title: string;
            status: string;
            window?: StudyDateWindow | null;
            label?: string;
          };
          blocks: BlockItem[];
          preflight: Preflight;
          editions?: EditionMeta[];
        };
        if (activeIdRef.current !== reviewId) return;
        setTitle(json.review.title);
        setStatus(json.review.status);
        setBlocks(json.blocks);
        setPreflight(json.preflight);
        setEditions(json.editions ?? []);
        const w = json.review.window;
        setWindowFrom(w?.from ?? "");
        setWindowTo(w?.to ?? "");
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
    // Shelf shows this client's own metrics only — drop tenant-wide "general"
    // (client_user_id === null) definitions from the library list.
    setMetrics(
      (json.metrics ?? []).filter((m) => m.client_user_id === clientUserId)
    );
  }, [base, clientUserId]);

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
          setEditions([]);
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
        setError("Study archived.");
        await refresh(activeId === review.id ? null : activeId);
      } else {
        const res = await fetch(`${base}/reviews/${review.id}?hard=1`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error ?? "Delete failed");
        }
        setError("Study deleted.");
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
      setError("Study restored.");
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

  function figurePickable(block: BlockItem): Pickable | null {
    if (!block.metric_id) return null;
    return {
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
  }

  function studyPickable(block: BlockItem): Pickable | null {
    if (!block.study_id) return null;
    const snap = isPlacedStudySnapshot(block.placed_snapshot)
      ? block.placed_snapshot
      : null;
    return {
      kind: "study",
      ref: block.study_id,
      label: snap?.name ?? block.metric_name ?? "Model",
      sublabel: snap?.type,
    };
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

  /** Spec B19 — persist Study window; server refreshes placed_snapshot preview cache. */
  async function saveStudyWindow(from: string, to: string) {
    if (!activeId || status !== "draft") return;
    const window =
      from && to && to >= from ? { from, to } : null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ window }),
      });
      const json = (await res.json()) as {
        error?: string;
        review?: { window?: StudyDateWindow | null };
      };
      if (!res.ok) throw new Error(json.error ?? "Window save failed");
      const w = json.review?.window;
      setWindowFrom(w?.from ?? from);
      setWindowTo(w?.to ?? to);
      await loadReview(activeId);
      if (previewAsClient) await runClientPreview(activeId, w ?? window);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Window save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runClientPreview(
    reviewId: string,
    window?: StudyDateWindow | null
  ) {
    const body =
      window && window.from && window.to
        ? { window }
        : windowFrom && windowTo
          ? { window: { from: windowFrom, to: windowTo } }
          : {};
    const res = await fetch(`${base}/reviews/${reviewId}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      error?: string;
      snapshot?: {
        meta: { title: string; reviewed_as_of: string; version: number };
        cover_figures: Array<{
          label: string;
          value: number | string;
          caption?: string;
        }>;
        blocks: Array<Record<string, unknown>>;
      };
    };
    if (!res.ok) throw new Error(json.error ?? "Preview failed");
    setClientPreview(json.snapshot ?? null);
  }

  async function togglePreviewAsClient() {
    if (!activeId) return;
    const next = !previewAsClient;
    setPreviewAsClient(next);
    if (!next) {
      setClientPreview(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runClientPreview(activeId);
    } catch (e) {
      setPreviewAsClient(false);
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  function openPublishDialog() {
    // Spec B19-B1 — re-publish allowed while published (Edition N+1).
    if (!activeId || (status !== "draft" && status !== "published")) return;
    const ver =
      (reviews.find((r) => r.id === activeId)?.current_version ?? 0) + 1;
    setEditionLabel(title.trim() || `Edition ${ver}`);
    if (windowFrom && windowTo) {
      setPublishFrom(windowFrom);
      setPublishTo(windowTo);
    } else {
      const d = defaultStudyWindow();
      setPublishFrom(d.from);
      setPublishTo(d.to);
    }
    setPublishOpen(true);
  }

  async function publish() {
    if (!activeId) return;
    if (!publishFrom || !publishTo || publishTo < publishFrom) {
      setError("Edition window requires from ≤ to (YYYY-MM-DD)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews/${activeId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editionLabel.trim() || undefined,
          window: { from: publishFrom, to: publishTo },
        }),
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
      setPublishOpen(false);
      setPreviewAsClient(false);
      setClientPreview(null);
      await refresh(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
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

  /** B17 — layout write only; optimistic, no recompute / no full reload. */
  async function setBlockLayout(blockId: string, layout: ReviewBlockLayout) {
    if (!activeId || status !== "draft") return;
    const prev = blocks.find((b) => b.id === blockId)?.layout ?? null;
    setBlocks((list) =>
      list.map((b) => (b.id === blockId ? { ...b, layout } : b))
    );
    try {
      const res = await fetch(`${base}/reviews/${activeId}/blocks/${blockId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_layout", layout }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Layout update failed");
      }
    } catch (e) {
      setBlocks((list) =>
        list.map((b) => (b.id === blockId ? { ...b, layout: prev } : b))
      );
      setError(e instanceof Error ? e.message : "Layout update failed");
    }
  }

  async function persistBlockOrder(next: BlockItem[]) {
    if (!activeId || status !== "draft") return;
    const order = next.map((b) => b.id);
    const res = await fetch(`${base}/reviews/${activeId}/blocks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error ?? "Reorder failed");
    }
  }

  function applyReorder(fromId: string, beforeId: string | null) {
    if (fromId === beforeId) return;
    const fromIdx = blocks.findIndex((b) => b.id === fromId);
    if (fromIdx < 0) return;
    const next = [...blocks];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    let toIdx =
      beforeId == null
        ? next.length
        : next.findIndex((b) => b.id === beforeId);
    if (toIdx < 0) toIdx = next.length;
    next.splice(toIdx, 0, moved);
    const withPos = next.map((b, i) => ({ ...b, position: i + 1 }));
    setBlocks(withPos);
    void persistBlockOrder(withPos).catch((e) => {
      setError(e instanceof Error ? e.message : "Reorder failed");
      if (activeId) void loadReview(activeId);
    });
  }

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      if (w < 520) setCanvasBp("phone");
      else if (w < 860) setCanvasBp("tablet");
      else setCanvasBp("desktop");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeId]);

  function onBlockPointerDown(e: PointerEvent, blockId: string) {
    if (status !== "draft") return;
    const handle = (e.target as HTMLElement).closest("[data-drag-handle]");
    if (!handle) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(blockId);
  }

  function onBlockPointerMove(e: PointerEvent) {
    if (!dragId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const article = el?.closest?.("[data-block-id]") as HTMLElement | null;
    if (!article) return;
    const id = article.getAttribute("data-block-id");
    if (!id || id === dragId) return;
    const rect = article.getBoundingClientRect();
    const mid =
      canvasBp === "phone"
        ? rect.top + rect.height / 2
        : rect.left + rect.width / 2;
    const coord = canvasBp === "phone" ? e.clientY : e.clientX;
    const ids = blocks.map((b) => b.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    if (coord < mid) setDropBeforeId(id);
    else setDropBeforeId(idx < ids.length - 1 ? ids[idx + 1]! : "__end__");
  }

  function onBlockPointerUp() {
    if (!dragId) return;
    const from = dragId;
    const before = dropBeforeId === "__end__" ? null : dropBeforeId;
    setDragId(null);
    setDropBeforeId(null);
    applyReorder(from, before);
  }

  const canPublish = status === "draft" || status === "published";
  const publishBlocked =
    !preflight ||
    preflight.proposed_count > 0 ||
    preflight.envelope_violations.length > 0 ||
    // Stale is an authoring concern (recompute is draft-only); publish recomputes fresh.
    (status === "draft" && preflight.stale_count > 0);

  const gateLevel =
    status === "archived"
      ? "ready"
      : !canPublish
        ? "ready"
        : blocks.length === 0
          ? "quiet"
          : publishBlocked
            ? "blocked"
            : "ready";

  const activeReview = reviews.find((r) => r.id === activeId);
  const nextVersion = (activeReview?.current_version ?? 0) + 1;
  // Spec B15-FIXES-2: never surface stale ids on frozen issues (display).
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
        <div className="rcx-kick">Studies</div>
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
                title="Study actions"
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
          + New study
        </button>
      </aside>

      {/* ── Document (centre) ───────────────────────── */}
      <section className="rcx-doc">
        <div className="rcx-gate" data-level={gateLevel}>
          <span className="gt">{title || "Draft study"}</span>
          <span className={`gc${gateLevel === "blocked" ? " warn" : ""}`}>
            {preflight
              ? `Proposed ${preflight.proposed_count} · Stale ${preflight.stale_count} · Envelope ${preflight.envelope_violations.length}`
              : activeId
                ? "Loading preflight…"
                : "No draft study"}
          </span>
          <span className="spacer" />
          <span className="hint">
            {gateLevel === "quiet"
              ? "Nothing to publish yet"
              : publishBlocked
                ? "Clean the preflight to publish"
                : status === "draft"
                  ? `Preflight clean · freezes ${blocks.length} blocks`
                  : status === "published"
                    ? `Publish next Edition · v${nextVersion}`
                    : "Published"}
          </span>
          {canPublish && activeId ? (
            <>
              <label className="rcx-win">
                From
                <input
                  type="date"
                  value={windowFrom}
                  disabled={busy}
                  onChange={(e) => setWindowFrom(e.target.value)}
                  onBlur={() => {
                    // Persist Study.window only while drafting; published uses local
                    // window for preview + publish body (PATCH remains draft-only).
                    if (
                      status === "draft" &&
                      windowFrom &&
                      windowTo &&
                      windowTo >= windowFrom
                    ) {
                      void saveStudyWindow(windowFrom, windowTo);
                    }
                  }}
                />
              </label>
              <label className="rcx-win">
                To
                <input
                  type="date"
                  value={windowTo}
                  disabled={busy}
                  onChange={(e) => setWindowTo(e.target.value)}
                  onBlur={() => {
                    if (
                      status === "draft" &&
                      windowFrom &&
                      windowTo &&
                      windowTo >= windowFrom
                    ) {
                      void saveStudyWindow(windowFrom, windowTo);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className={`rcx-btn sm ghost${previewAsClient ? " on" : ""}`}
                disabled={busy || blocks.length === 0}
                onClick={() => void togglePreviewAsClient()}
              >
                {previewAsClient ? "Editing" : "Preview as client"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={`rcx-btn sm${gateLevel === "ready" && canPublish ? "" : " ghost"}`}
            disabled={busy || !canPublish || publishBlocked}
            onClick={() => openPublishDialog()}
          >
            {canPublish ? `Publish v${nextVersion}` : "Published"}
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
            <p className="rcx-muted">Create or select a draft study to begin.</p>
          </div>
        ) : isLoadingIssue ? (
          <div className="rcx-paper">
            <div className="rcx-cover">
              <div className="ct">{title || "Study"}</div>
              <div className="cs">Loading…</div>
            </div>
            <p className="rcx-muted" style={{ padding: "24px 0" }}>
              Loading {title || "study"}…
            </p>
          </div>
        ) : (
          <div className="rcx-paper">
            <header className="rcx-shead" data-testid="study-header">
              <div className="rcx-shead-main">
                <div className="rcx-kicker">
                  Study ·{" "}
                  <span className="tl">
                    {status === "draft" ? "draft" : status}
                  </span>
                </div>
                <input
                  className="rcx-stitle"
                  value={title}
                  placeholder="Name this study"
                  disabled={status !== "draft"}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    void saveTitle().catch((e) =>
                      setError(e instanceof Error ? e.message : "Title save failed")
                    );
                  }}
                />
                <div className="rcx-smeta">
                  {status === "draft" ? "Draft" : status.toUpperCase()}
                  {activeReview?.current_version
                    ? ` · Edition v${activeReview.current_version}`
                    : ""}
                  {windowFrom && windowTo
                    ? ` · ${windowFrom} → ${windowTo}`
                    : " · trailing 12 (default)"}
                  {` · ${blocks.length} block${blocks.length === 1 ? "" : "s"}`}
                </div>
              </div>
              {(() => {
                const ob = openingBalanceFromBlocks(blocks);
                if (!ob) return null;
                return (
                  <div className="rcx-ob" data-testid="opening-balance-card">
                    <div className="ob-l">
                      Opening balance
                      <span
                        className={`chip${ob.source === "manual" ? " on" : ""}`}
                      >
                        {ob.source === "manual"
                          ? "manual"
                          : ob.source === "unknown"
                            ? "unknown"
                            : "from ledger"}
                      </span>
                    </div>
                    <div className="ob-f">
                      <span className="cur">$</span>
                      <span className="ob-v">{fmtMoney(ob.value).replace(/^\$/, "")}</span>
                    </div>
                    <div className="ob-s">
                      From placed Model snapshot · edit via cash-model / B18 flow.
                    </div>
                  </div>
                );
              })()}
            </header>

            {editions.length > 0 ? (
              <div className="rcx-editions" data-testid="editions-strip">
                <span className="ed-k">Editions</span>
                <ul className="ed-list">
                  {editions.map((ed) => {
                    const name =
                      (ed.label ?? "").trim() || `Edition ${ed.version}`;
                    const win =
                      ed.window?.from && ed.window?.to
                        ? `${ed.window.from} → ${ed.window.to}`
                        : "—";
                    const when = ed.published_at
                      ? ed.published_at.slice(0, 10)
                      : ed.reviewed_as_of?.slice(0, 10) ?? "";
                    return (
                      <li key={ed.id} className="ed-item">
                        <span className="ed-n">{name}</span>
                        <span className="ed-m">
                          {win}
                          {when ? ` · ${when}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {canPublish ? (
                  <button
                    type="button"
                    className="rcx-tool"
                    disabled={busy || publishBlocked}
                    onClick={() => openPublishDialog()}
                  >
                    Re-publish
                  </button>
                ) : null}
              </div>
            ) : null}

            {previewAsClient && clientPreview ? (
              <div className="rcx-client-prev" data-testid="preview-as-client">
                <p className="rcx-muted" style={{ marginBottom: 12 }}>
                  Client envelope preview · not frozen until Publish
                </p>
                <h2 className="rcx-prev-title">{clientPreview.meta.title}</h2>
                <p className="rcx-muted">
                  Reviewed as of {clientPreview.meta.reviewed_as_of}
                </p>
                {clientPreview.cover_figures.length ? (
                  <div className="rcx-prev-figs">
                    {clientPreview.cover_figures.map((f, i) => (
                      <div key={i} className="rcx-prev-fig">
                        <div className="l">{f.label}</div>
                        <div className="v">
                          {typeof f.value === "number"
                            ? f.value.toLocaleString()
                            : String(f.value)}
                        </div>
                        {f.caption ? <div className="c">{f.caption}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <ul className="rcx-prev-blocks">
                  {clientPreview.blocks.map((b, i) => (
                    <li key={i}>
                      <strong>{String(b.role ?? "block")}</strong>
                      {b.label || b.name || b.title
                        ? ` · ${String(b.label ?? b.name ?? b.title)}`
                        : ""}
                      {typeof b.value === "number"
                        ? ` · ${b.value.toLocaleString()}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {status === "draft" && blocks.length === 0 && !previewAsClient ? (
              <div className="rcx-empty" data-testid="study-empty-state">
                <div className="et">Nothing on the page yet</div>
                <div className="eh">Build this study like a page</div>
                <div className="ep">
                  Add a metric from the shelf — narrow cards read as figures, wide
                  cards draw as charts. Write text between them. Everything stays on
                  this side until you publish an Edition.
                </div>
                <div className="rcx-ecards">
                  <button
                    type="button"
                    className="rcx-ecard"
                    onClick={() => {
                      setShelfOpen(true);
                      setBuilderOpen(true);
                    }}
                  >
                    <b>Compose a metric</b>
                    <span>“sum of checks, by week” — opens the wizard</span>
                  </button>
                  <button
                    type="button"
                    className="rcx-ecard"
                    onClick={() => void addNote()}
                  >
                    <b>Write text</b>
                    <span>Inline note on the page</span>
                  </button>
                  <button
                    type="button"
                    className="rcx-ecard"
                    onClick={() => openShelfFor("figure")}
                  >
                    <b>Add a figure</b>
                    <span>Place a headline number from the shelf</span>
                  </button>
                </div>
              </div>
            ) : null}

            {!previewAsClient ? (
            <div
              className={`rcx-canvas${dragId ? " dragging" : ""}`}
              ref={canvasRef}
              data-bp={canvasBp}
            >
            <div className="rcx-grid">
            {blocks.map((block) => {
              const isProposed = block.proposal_state === "proposed";
              const isStale = staleIds.includes(block.id);
              const isStudy = block.role === "study";
              const hasMetric =
                block.role === "figure" || block.role === "exhibit";
              const viewMode = block.view_mode === "table" ? "table" : "chart";
              const layout = resolveLayout(block.layout);
              const asChart =
                hasMetric && renderMetricAsChart(layout, block.placed_snapshot);
              const hasSeries = snapshotHasSeries(block.placed_snapshot);
              const colSpan = gridColumnSpan(layout, canvasBp);
              const studySnap = isPlacedStudySnapshot(block.placed_snapshot)
                ? block.placed_snapshot
                : null;
              const dropCls =
                dropBeforeId === block.id
                  ? " drop-before"
                  : dropBeforeId === "__end__" &&
                      blocks[blocks.length - 1]?.id === block.id
                    ? " drop-after"
                    : "";
              return (
                <article
                  key={block.id}
                  className={`rcx-block blk${asChart ? " ex" : hasMetric ? " fig" : ""}${dragId === block.id ? " ghost" : ""}${dropCls}`}
                  data-block-id={block.id}
                  data-gate={isProposed ? "proposed" : isStale ? "stale" : undefined}
                  data-role={asChart ? "exhibit" : hasMetric ? "figure" : block.role}
                  style={{
                    gridColumn: `span ${colSpan}`,
                    gridRow: canvasBp === "phone" ? undefined : `span ${layout.h}`,
                  }}
                  onPointerDown={(e) => onBlockPointerDown(e, block.id)}
                  onPointerMove={onBlockPointerMove}
                  onPointerUp={onBlockPointerUp}
                  onPointerCancel={onBlockPointerUp}
                >
                  <div className="rcx-bchrome">
                    {status === "draft" ? (
                      <button
                        type="button"
                        className="rcx-drag"
                        data-drag-handle
                        aria-label="Reorder block"
                        style={{ touchAction: "none" }}
                      >
                        ⠿
                      </button>
                    ) : null}
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
                    {status === "draft" ? (
                      <span className="rcx-sz" role="group" aria-label="Block size">
                        {LAYOUT_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`rcx-tool${layout.w === p.w ? " primary" : ""}`}
                            onClick={() =>
                              void setBlockLayout(block.id, { w: p.w, h: p.h })
                            }
                          >
                            {p.label}
                          </button>
                        ))}
                      </span>
                    ) : null}
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
                      {(hasMetric || isStudy) &&
                      (showChartTableToggle(layout, block.placed_snapshot) ||
                        isStudy) ? (
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
                      {hasMetric && showChartTableToggle(layout, block.placed_snapshot) ? (
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
                      {hasMetric && onPick && figurePickable(block) ? (
                        <PickButton
                          variant="header"
                          pickable={figurePickable(block)!}
                          disabled={busy}
                          onPick={onPick}
                        />
                      ) : null}
                      {isStudy && onPick && studyPickable(block) ? (
                        <PickButton
                          variant="header"
                          pickable={studyPickable(block)!}
                          disabled={busy}
                          ariaLabel="Add this model to a draft"
                          onPick={onPick}
                        />
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
                      onPick={onPick}
                    />
                  ) : null}

                  {/* B17: chart only when series exists in cache AND w≥6; value-only stays tile. */}
                  {hasMetric && asChart &&
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
                  {hasMetric && asChart &&
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
                  {hasMetric && !asChart ? (
                    <div className="rcx-figval">
                      {(() => {
                        const summary =
                          summaryValueFromSnapshot(block.placed_snapshot) ??
                          (typeof (block.placed_snapshot as { value?: number } | null)
                            ?.value === "number"
                            ? (block.placed_snapshot as { value: number }).value
                            : null);
                        return summary != null
                          ? summary.toLocaleString(undefined, {
                              style: "currency",
                              currency: "USD",
                              maximumFractionDigits: 0,
                            })
                          : "—";
                      })()}
                      {hasSeries && layout.w <= 3 ? (
                        <span className="rcx-fighint"> · summary</span>
                      ) : null}
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
                  {status === "draft" && canvasBp === "desktop" ? (
                    <button
                      type="button"
                      className="rcx-rz"
                      aria-label="Resize block"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const startX = e.clientX;
                        const startW = layout.w;
                        const target = e.currentTarget;
                        target.setPointerCapture(e.pointerId);
                        const onMove = (ev: globalThis.PointerEvent) => {
                          const grid = canvasRef.current?.querySelector(".rcx-grid");
                          const gw = grid?.clientWidth ?? 720;
                          const colW = gw / 12;
                          const dw = Math.round((ev.clientX - startX) / colW);
                          const nextW = Math.min(12, Math.max(1, startW + dw));
                          setBlocks((list) =>
                            list.map((b) =>
                              b.id === block.id
                                ? { ...b, layout: { w: nextW, h: layout.h } }
                                : b
                            )
                          );
                        };
                        const onUp = (ev: globalThis.PointerEvent) => {
                          target.releasePointerCapture(ev.pointerId);
                          target.removeEventListener("pointermove", onMove);
                          target.removeEventListener("pointerup", onUp);
                          const grid = canvasRef.current?.querySelector(".rcx-grid");
                          const gw = grid?.clientWidth ?? 720;
                          const colW = gw / 12;
                          const dw = Math.round((ev.clientX - startX) / colW);
                          const nextW = Math.min(12, Math.max(1, startW + dw));
                          void setBlockLayout(block.id, { w: nextW, h: layout.h });
                        };
                        target.addEventListener("pointermove", onMove);
                        target.addEventListener("pointerup", onUp);
                      }}
                    />
                  ) : null}
                </article>
              );
            })}
            </div>
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
          <StudiesPanel
            clientUserId={clientUserId}
            reviewId={activeId}
            reviewStatus={status}
            busy={busy}
            onPlaced={() => {
              if (activeId) void loadReview(activeId);
            }}
            onError={setError}
            onOpenStudio={() => setStudioOpen(true)}
            refreshKey={modelsRefreshKey}
            placedStudyIds={blocks
              .filter((b) => b.role === "study" && b.study_id)
              .map((b) => b.study_id as string)}
          />
          <div className="rcx-kick" style={{ marginTop: 12 }}>
            Metrics
          </div>
          <div className="rcx-kick" style={{ margin: "8px 0 2px", fontSize: 10 }}>
            Metric library · {metrics.length}
          </div>
          <>
          <div className="rcx-slist">
            {metrics.map((m) => (
              <div key={m.id} className="rcx-sitem">
                <div className="sn">
                  {m.name}
                  <span className="chip">
                    {m.kind === "value"
                      ? "Value"
                      : m.kind === "comparison"
                        ? "Compare"
                        : "Series"}
                  </span>
                </div>
                <div className="sk">
                  {m.computed_at
                    ? `Computed ${m.computed_at.slice(0, 10)}`
                    : "Not computed yet"}
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
                No metrics yet. Compose one below.
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
              Opens the sentence wizard in a popup. Never client-visible.
            </p>
          </div>
            </>
          </aside>
        </>
      ) : null}

      {/* ── New-metric wizard (popup) ─────────────────── */}
      {builderOpen ? (
        <div
          className="rcx-modal-scrim"
          onClick={() => {
            setBuilderOpen(false);
            void loadMetrics();
          }}
        >
          <div
            className="rcx-modal"
            data-testid="shelf-metric-wizard"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sh" style={{ marginBottom: 12 }}>
              <span className="st">New metric</span>
              <button
                type="button"
                className="rcx-tool"
                onClick={() => {
                  setBuilderOpen(false);
                  void loadMetrics();
                }}
              >
                Done
              </button>
            </div>
            <MetricsTab clientUserId={clientUserId} dataThrough={dataThrough} />
          </div>
        </div>
      ) : null}

      <ModelStudio
        clientUserId={clientUserId}
        reviewId={activeId}
        reviewStatus={status}
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        onSaved={({ placed }) => {
          setModelsRefreshKey((k) => k + 1);
          if (placed && activeId) void loadReview(activeId);
        }}
        onError={setError}
      />

      {publishOpen ? (
        <>
          <div className="rcx-scrim" onClick={() => !busy && setPublishOpen(false)} />
          <div
            className="rcx-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Publish edition"
          >
            <div className="rcx-confirm-title">Publish Edition</div>
            <p className="rcx-muted" style={{ marginBottom: 12 }}>
              Freezes a fresh compute over this window — same path as preview.
            </p>
            <label className="rcx-win" style={{ display: "block", marginBottom: 8 }}>
              Edition name
              <input
                type="text"
                value={editionLabel}
                disabled={busy}
                onChange={(e) => setEditionLabel(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </label>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <label className="rcx-win">
                From
                <input
                  type="date"
                  value={publishFrom}
                  disabled={busy}
                  onChange={(e) => setPublishFrom(e.target.value)}
                />
              </label>
              <label className="rcx-win">
                To
                <input
                  type="date"
                  value={publishTo}
                  disabled={busy}
                  onChange={(e) => setPublishTo(e.target.value)}
                />
              </label>
            </div>
            <div className="rcx-confirm-actions">
              <button
                type="button"
                className="rcx-btn ghost sm"
                disabled={busy}
                onClick={() => setPublishOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rcx-btn sm"
                disabled={busy}
                onClick={() => void publish()}
              >
                Publish v{nextVersion}
              </button>
            </div>
          </div>
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
              {pendingAction.kind === "archive" ? "Archive study" : "Delete study"}
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
.rcx-win{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--mute);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.rcx-win input{font:inherit;font-size:12px;letter-spacing:0;text-transform:none;font-weight:500;color:var(--ink);border:1px solid var(--paper-edge);border-radius:6px;padding:3px 6px;background:var(--paper,#fff)}
.rcx-btn.ghost.on{background:color-mix(in srgb,var(--su-accept,#174a7a) 12%,#fff);border-color:color-mix(in srgb,var(--su-accept,#174a7a) 35%,var(--line))}
.rcx-client-prev{margin-top:16px;padding-top:8px;border-top:1px solid var(--paper-edge)}
.rcx-prev-title{font-size:20px;font-weight:700;margin:4px 0 6px}
.rcx-prev-figs{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:14px 0}
.rcx-prev-fig{border:1px solid var(--paper-edge);border-radius:8px;padding:10px 12px}
.rcx-prev-fig .l{font-size:11px;color:var(--mute)}
.rcx-prev-fig .v{font-size:18px;font-weight:600;margin-top:2px}
.rcx-prev-fig .c{font-size:11px;color:var(--mute);margin-top:4px}
.rcx-prev-blocks{list-style:none;margin:0;padding:0;font-size:13px}
.rcx-prev-blocks li{padding:6px 0;border-bottom:1px solid var(--paper-edge)}
.rcx-viol{list-style:none;margin:0 0 12px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--su-warn,#c8881f) 8%,#fff);border:1px solid color-mix(in srgb,var(--su-warn,#c8881f) 30%,var(--line));font-size:12px;color:var(--su-warn-ink)}
.rcx-err{background:color-mix(in srgb,var(--su-neg,#b23a2e) 7%,#fff);border:1px solid color-mix(in srgb,var(--su-neg,#b23a2e) 28%,var(--line));color:var(--su-neg);border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:14px}
/* paper */
.rcx-doc{min-width:0}
.rcx-paper{max-width:960px;margin:0 auto;background:var(--paper,#fff);border:1px solid var(--paper-edge);border-radius:12px;box-shadow:var(--paper-shadow);padding:28px 36px}
/* B19-C2 study header (mockup .s-head / .ob) */
.rcx-shead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 24px;align-items:start;padding-bottom:16px;border-bottom:1px solid var(--paper-edge);margin-bottom:16px}
.rcx-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);font-weight:700;display:flex;align-items:center;gap:8px}
.rcx-kicker .tl{text-transform:none;letter-spacing:0;font-weight:600;color:var(--slate,#364657)}
.rcx-stitle{display:block;font-size:26px;font-weight:700;letter-spacing:-.01em;border:none;outline:none;width:100%;background:transparent;color:var(--ink);font-family:inherit;padding:2px 0;margin:6px 0 4px}
.rcx-stitle:disabled{opacity:.85}
.rcx-smeta{font-size:12.5px;color:var(--mute);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.rcx-ob{background:color-mix(in srgb,var(--canvas-2,#eef3f9) 80%,#fff);border:1px solid var(--paper-edge);border-radius:8px;padding:12px 14px;min-width:240px}
.rcx-ob .ob-l{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}
.rcx-ob .ob-f{display:flex;align-items:baseline;gap:4px;margin:8px 0 6px}
.rcx-ob .cur{font-size:18px;color:var(--mute);font-weight:600}
.rcx-ob .ob-v{font-size:24px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.rcx-ob .ob-s{font-size:11.5px;color:var(--mute)}
.rcx-ob .chip{font-size:10.5px;font-weight:700;color:var(--mute);background:#fff;border:1px solid var(--paper-edge);border-radius:999px;padding:2px 8px}
.rcx-ob .chip.on{color:var(--su-accept,#174a7a);border-color:color-mix(in srgb,var(--su-accept,#174a7a) 30%,var(--line));background:color-mix(in srgb,var(--su-accept,#174a7a) 8%,#fff)}
.rcx-editions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 0 14px;margin-bottom:8px;border-bottom:1px solid var(--paper-edge)}
.rcx-editions .ed-k{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--mute)}
.rcx-editions .ed-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px;flex:1}
.rcx-editions .ed-item{font-size:12px;border:1px solid var(--paper-edge);border-radius:8px;padding:5px 10px;background:color-mix(in srgb,var(--canvas-2) 40%,#fff)}
.rcx-editions .ed-n{font-weight:600;margin-right:6px}
.rcx-editions .ed-m{color:var(--mute)}
.rcx-cover .ct{font-size:26px;font-weight:700;letter-spacing:-.01em;border:none;outline:none;width:100%;background:transparent;color:var(--ink);font-family:inherit;padding:0}
.rcx-cover .cs{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-top:5px}
/* B17 canvas */
.rcx-canvas{position:relative;min-height:120px;margin-top:12px}
.rcx-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:minmax(112px,auto);gap:12px;align-items:stretch}
.rcx-canvas[data-bp="tablet"] .rcx-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(124px,auto)}
.rcx-canvas[data-bp="phone"] .rcx-grid{display:flex;flex-direction:column;gap:10px}
.rcx-canvas.dragging .rcx-grid{background:color-mix(in srgb,var(--accent,#3e6e8e) 6%,transparent);border-radius:8px}
.rcx-block{position:relative;background:var(--paper,#fff);border:1px solid var(--paper-edge);border-radius:10px;padding:12px 14px 10px;min-width:0;display:flex;flex-direction:column;margin:0}
.rcx-block.ghost{opacity:.4}
.rcx-block.drop-before::before,.rcx-block.drop-after::after{content:"";position:absolute;top:0;bottom:0;width:3px;background:var(--accent,#3e6e8e);border-radius:2px;z-index:3}
.rcx-block.drop-before::before{left:-7px}.rcx-block.drop-after::after{right:-7px}
.rcx-canvas[data-bp="phone"] .rcx-block.drop-before::before,.rcx-canvas[data-bp="phone"] .rcx-block.drop-after::after{left:0;right:0;width:auto;height:3px;top:auto;bottom:auto}
.rcx-canvas[data-bp="phone"] .rcx-block.drop-before::before{top:-6px}.rcx-canvas[data-bp="phone"] .rcx-block.drop-after::after{bottom:-6px}
.rcx-block[data-gate="proposed"] .rcx-cap{background:color-mix(in srgb,var(--su-await,#3e6e8e) 7%,#fff);border-color:color-mix(in srgb,var(--su-await,#3e6e8e) 30%,var(--line))}
.rcx-bchrome{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-bottom:8px}
.rcx-drag{font:inherit;border:0;background:var(--canvas,#eef3f9);color:var(--mute);border-radius:6px;padding:2px 8px;cursor:grab;line-height:1.2;touch-action:none}
.rcx-drag:active{cursor:grabbing}
.rcx-sz{display:inline-flex;gap:2px;flex-wrap:wrap}
.rcx-rz{position:absolute;right:2px;bottom:2px;width:16px;height:16px;padding:0;border:0;background:transparent;cursor:nwse-resize;opacity:0;color:var(--mute)}
.rcx-block:hover .rcx-rz,.rcx-block:focus-within .rcx-rz{opacity:1}
.rcx-rz::before{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor}
.rcx-canvas[data-bp="phone"] .rcx-rz,.rcx-canvas[data-bp="tablet"] .rcx-rz{display:none}
.rcx-canvas[data-bp="phone"] .rcx-bchrome,.rcx-canvas[data-bp="tablet"] .rcx-bchrome{opacity:1}
.rcx-src{font-size:12px;color:var(--mute);flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rcx-tools{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px}
.rcx-caprow{margin-top:2px}
.rcx-caplbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;display:block;margin-bottom:5px}
.rcx-cap{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:13.5px;line-height:1.5;color:var(--ink);background:color-mix(in srgb,var(--canvas,#eef3f9) 40%,#fff);resize:vertical;min-height:54px}
.rcx-cap:focus{outline:none;border-color:var(--brand);background:#fff}
.rcx-note{font-size:14px;line-height:1.55;white-space:pre-wrap;color:var(--slate)}
.rcx-chart{margin:6px 0 12px;max-width:100%;flex:1;min-height:0}
.rcx-chart svg{max-width:100%;height:auto}
.rcx-figval{font-size:clamp(22px,2.4vw,30px);font-weight:700;color:var(--ink);letter-spacing:-.01em;margin:2px 0 8px}
.rcx-fighint{font-size:12px;font-weight:600;color:var(--mute);letter-spacing:0}
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
.rcx-empty{border:2px dashed #c9d8ec;border-radius:11px;background:color-mix(in srgb,var(--canvas,#eef3f9) 55%,transparent);padding:44px 30px;text-align:center;margin-top:20px;min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.rcx-empty .et{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}
.rcx-empty .eh{font-size:20px;font-weight:700;margin:8px 0 6px;color:var(--ink)}
.rcx-empty .ep{font-size:13px;color:var(--slate);max-width:470px;margin:0 auto 16px;line-height:1.55}
.rcx-ecards{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.rcx-ecard{background:#fff;border:1px solid var(--paper-edge);border-radius:10px;padding:12px 16px;cursor:pointer;text-align:left;min-width:190px;font:inherit;transition:border-color .15s,transform .12s,box-shadow .15s}
.rcx-ecard:hover{border-color:var(--accent,#1fc5d9);transform:translateY(-1px);box-shadow:var(--paper-shadow)}
.rcx-ecard b{display:block;color:var(--su-accept,#174a7a);font-size:13.5px;margin-bottom:4px}
.rcx-ecard span{font-size:12px;color:var(--mute)}
.rcx-sitem{display:grid;grid-template-columns:minmax(0,1fr);gap:2px;border:1px solid var(--paper-edge);border-radius:9px;padding:9px 10px;background:#fff;transition:border-color .15s,box-shadow .15s}
.rcx-sitem:hover{border-color:var(--accent,#1fc5d9);box-shadow:var(--paper-shadow)}
.rcx-sitem .sn{font-size:13px;font-weight:700;line-height:1.2;display:flex;gap:6px;align-items:center;overflow:hidden}
.rcx-sitem .sn .chip{margin-left:auto;flex:0 0 auto;font-size:10px;letter-spacing:.04em;text-transform:uppercase;font-weight:700;color:var(--mute);border:1px solid var(--paper-edge);border-radius:999px;padding:1px 7px}
.rcx-sitem .sk{font-size:11.5px;color:var(--mute);margin-top:2px}
.rcx-sitem .sb{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.rcx-inline-wiz{border:1px solid var(--paper-edge);border-radius:10px;padding:10px;margin-bottom:12px;background:color-mix(in srgb,var(--canvas-2) 35%,#fff);max-height:70vh;overflow:auto}
.rcx-ecards{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.rcx-ecard{border:1px solid var(--paper-edge);background:#fff;border-radius:9px;padding:12px 20px;font-weight:600;font-size:13px;color:var(--brand);cursor:pointer}
.rcx-ecard:hover{border-color:var(--brand);box-shadow:var(--paper-shadow)}
.rcx-addbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-top:1px dashed var(--canvas-2);margin-top:22px;padding-top:16px}
.rcx-addbar .al{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-right:2px}
/* shelf */
.rcx-shelf-scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--ink,#102a47) 28%,transparent);z-index:60;animation:rcxfade .18s ease}
.rcx-shelf{position:fixed;top:0;right:0;bottom:0;width:min(348px,92vw);z-index:61;background:var(--rail,#fff);border-left:1px solid var(--paper-edge);box-shadow:-18px 0 54px rgba(16,42,71,.18);padding:16px 16px;display:flex;flex-direction:column;overflow:auto;animation:rcxslide .2s ease}
.rcx-shelf[data-wiz="1"]{width:min(520px,96vw)}
/* new-metric wizard popup */
.rcx-modal-scrim{position:fixed;inset:0;z-index:80;background:color-mix(in srgb,var(--ink,#102a47) 40%,transparent);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow:auto;animation:rcxfade .16s ease}
.rcx-modal{width:min(760px,96vw);background:var(--rail,#fff);border:1px solid var(--paper-edge);border-radius:14px;box-shadow:0 24px 70px rgba(16,42,71,.28);padding:18px 20px;animation:rcxfade .18s ease}
/* Models group in the shelf */
.rcx-linkbtn{font:inherit;font-size:11px;font-weight:700;background:none;border:none;color:var(--cinnabar,#c8452f);cursor:pointer;padding:0;text-transform:none;letter-spacing:0}
.rcx-linkbtn:disabled{color:var(--mute);cursor:default}
.rcx-sitem.model .sn{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rcx-sitem.model .conf{margin-left:auto;font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.conf[data-grade="solid"]{background:#e6f4ec;color:#1f7a49}
.conf[data-grade="indicative"]{background:#fdf3e0;color:#a5701a}
.conf[data-grade="thin"]{background:#fcecec;color:#b03a2e}
.conf[data-grade="refused"]{background:#f0f0f2;color:#6b6b74}
.rcx-sitem.pending{border-style:dashed}
.rcx-sitem.new{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;border-style:dashed;cursor:pointer;text-align:left;width:100%;background:#fff}
.rcx-sitem.new .ico{grid-row:1/span 2;width:30px;height:30px;border-radius:7px;background:var(--canvas-2,#f4f1ea);display:grid;place-items:center;color:var(--cinnabar,#c8452f);font-weight:700;font-size:16px}
.rcx-sitem.new .sk{white-space:normal}
/* Model Studio popup (stepped) */
.wz-scrim{position:fixed;inset:0;z-index:82;background:color-mix(in srgb,var(--ink,#102a47) 40%,transparent);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow:auto;animation:rcxfade .16s ease}
.wz-panel{width:min(620px,96vw);background:var(--rail,#fff);border:1px solid var(--paper-edge);border-radius:14px;box-shadow:0 24px 70px rgba(16,42,71,.28);display:flex;flex-direction:column;animation:rcxfade .18s ease}
.wz-head{display:flex;align-items:flex-start;justify-content:space-between;padding:16px 18px 8px}
.wz-head h2{margin:2px 0 0;font-size:18px}
.wz-kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}
.wz-steps{display:flex;gap:6px;padding:0 18px 10px;border-bottom:1px solid var(--paper-edge)}
.wz-steps button{font:inherit;font-size:11px;font-weight:700;border:1px solid var(--paper-edge);background:#fff;color:var(--slate);border-radius:999px;padding:4px 10px;cursor:pointer}
.wz-steps button[aria-selected="true"]{background:var(--ink,#102a47);color:#fff;border-color:var(--ink,#102a47)}
.wz-steps button:disabled{opacity:.5;cursor:default}
.wz-body{padding:14px 18px;min-height:180px}
.wz-kinds{display:grid;gap:10px}
.wz-kindcard{text-align:left;border:1px solid var(--paper-edge);border-radius:10px;padding:12px 14px;background:#fff;cursor:pointer;display:grid;gap:3px;transition:border-color .15s,box-shadow .15s}
.wz-kindcard:hover{border-color:var(--cinnabar,#c8452f);box-shadow:var(--paper-shadow)}
.wz-kk{font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--mute);font-weight:700}
.wz-kindcard strong{font-size:15px}
.wz-kd{font-size:12px;color:var(--mute)}
.wz-form{display:grid;gap:12px}
.wz-fg{display:grid;gap:4px}
.wz-fg label{font-size:12px;font-weight:600;color:var(--slate);display:flex;align-items:center;gap:6px}
.wz-fg.toggle{grid-template-columns:1fr auto;align-items:center}
.wz-fg input,.wz-fg select{font:inherit;font-size:13px;border:1px solid var(--paper-edge);border-radius:7px;padding:6px 9px;background:#fff}
.wz-ctl{display:grid;gap:6px}
.wz-chip{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:999px;background:var(--canvas-2,#f4f1ea);color:var(--mute)}
.wz-help{font-size:11px;color:var(--mute)}
.wz-prevcard{border:1px solid var(--paper-edge);border-radius:10px;padding:14px;background:var(--canvas,#faf8f3)}
.wz-prevhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.wz-conf{font-size:10px;font-weight:700;padding:2px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.wz-conf[data-grade="solid"]{background:#e6f4ec;color:#1f7a49}
.wz-conf[data-grade="indicative"]{background:#fdf3e0;color:#a5701a}
.wz-conf[data-grade="thin"]{background:#fcecec;color:#b03a2e}
.wz-conf[data-grade="refused"]{background:#f0f0f2;color:#6b6b74}
.wz-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:10px}
.wz-kpi{border:1px solid var(--paper-edge);border-radius:8px;padding:7px 9px;background:#fff;display:grid;gap:1px}
.wz-kpi .l{font-size:10px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
.wz-kpi .v{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.wz-kpi .b{font-size:9.5px;color:var(--mute)}
.wz-spark{width:100%;height:90px;display:block;margin:4px 0 8px}
.wz-spark polyline{fill:none;stroke:var(--ink,#102a47);stroke-width:1.8}
.wz-spark polyline.proj{stroke-dasharray:3 3;opacity:.75}
.wz-spark rect{fill:var(--oxford,#33506b);opacity:.7}
.wz-note{font-size:12px;color:var(--slate);margin:6px 0}
.wz-reasons{margin:6px 0 0;padding-left:16px;font-size:11.5px;color:var(--mute)}
.wz-err{font-size:12px;color:#b03a2e;font-weight:600}
.wz-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:12px 18px;border-top:1px solid var(--paper-edge)}
.rcx-shelf .sh{display:flex;align-items:center;justify-content:space-between}
.rcx-shelf .st{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);font-weight:700}
.rcx-slist{overflow:auto;margin:6px -2px;padding:2px;display:flex;flex-direction:column;gap:8px;flex:1 1 auto}
.rcx-sfoot{margin-top:10px;padding-top:12px;border-top:1px solid var(--line)}
.rcx-shelf-mini{writing-mode:vertical-rl;transform:rotate(180deg);cursor:pointer;background:var(--rail,#fff);border:1px solid var(--paper-edge);border-radius:10px;box-shadow:var(--paper-shadow);padding:16px 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--slate);height:220px;align-self:start}
.rcx-scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--ink,#102a47) 35%,transparent);z-index:60;animation:rcxfade .18s ease}
.rcx-confirm{position:fixed;left:50%;top:28%;transform:translateX(-50%);z-index:70;width:min(420px,92vw);background:var(--su-paper,#FCFBF9);border:1px solid var(--su-line,#DED9D1);border-radius:10px;box-shadow:0 12px 40px rgba(16,42,71,.18);padding:18px 20px;animation:rcxfade .16s ease}
.rcx-confirm-title{font-size:15px;font-weight:700;color:var(--ink);margin-bottom:4px}
.rcx-confirm-body{font-size:13.5px;line-height:1.5;color:var(--ink);margin:8px 0 14px}
.rcx-confirm-label{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.rcx-confirm-input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;color:var(--ink);background:#fff}
.rcx-confirm-input:focus{outline:none;border-color:var(--brand)}
.rcx-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.rcx-btn.danger{background:var(--su-neg,#B42318);border-color:var(--su-neg,#B42318);color:#fff}
.study-author-stage{display:grid;grid-template-columns:minmax(0,1fr) 200px;gap:12px;margin-top:12px;align-items:start}
@media(max-width:720px){.study-author-stage{grid-template-columns:1fr}}
.study-shelf{border:1px solid var(--su-line,#DED9D1);border-radius:8px;padding:10px;background:var(--rail,#fff);position:sticky;top:8px}
@keyframes rcxslide{from{transform:translateX(40px);opacity:.4}to{transform:translateX(0);opacity:1}}
@keyframes rcxfade{from{opacity:0}to{opacity:1}}
`;
