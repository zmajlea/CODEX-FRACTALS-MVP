"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricsTab } from "@/components/operator/treasury/analytics/MetricsTab";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import type { MetricSeries } from "@/lib/treasury/metrics-eval";

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
  caption: string;
  body: string;
  proposal_state: string;
  metric_name?: string | null;
  suggested_caption?: string;
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

function stateChip(block: BlockItem): string {
  if (block.proposal_state === "proposed") return "PROPOSED · assistant";
  if (block.proposal_state === "confirmed") return "CONFIRMED · was proposed";
  return "READY";
}

export function ReviewTabPanel({ clientUserId, dataThrough }: Props) {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [shelfOpen, setShelfOpen] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingMetricId, setAddingMetricId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/operator/treasury/clients/${clientUserId}`;

  const loadReviews = useCallback(async () => {
    const res = await fetch(`${base}/reviews`);
    if (!res.ok) throw new Error("Failed to load reviews");
    const json = (await res.json()) as { reviews: ReviewItem[] };
    setReviews(json.reviews ?? []);
    return json.reviews ?? [];
  }, [base]);

  const loadReview = useCallback(
    async (reviewId: string) => {
      const res = await fetch(`${base}/reviews/${reviewId}`);
      if (!res.ok) throw new Error("Failed to load review");
      const json = (await res.json()) as {
        review: { id: string; title: string; status: string };
        blocks: BlockItem[];
        preflight: Preflight;
      };
      setActiveId(reviewId);
      setTitle(json.review.title);
      setStatus(json.review.status);
      setBlocks(json.blocks);
      setPreflight(json.preflight);
    },
    [base]
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
        const targetId = preferId ?? activeId;
        const picked =
          (targetId ? list.find((r) => r.id === targetId) : null) ??
          list.find((r) => r.status === "draft") ??
          list[0];
        if (picked) await loadReview(picked.id);
        else {
          setActiveId(null);
          setBlocks([]);
          setPreflight(null);
        }
        await loadMetrics();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
      }
    },
    [loadReviews, loadReview, loadMetrics, activeId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      if (res.status === 409 && json.existing?.id) {
        await loadReview(json.existing.id);
        setError(
          json.error ??
            "An issue for this period already exists — opened the existing issue."
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

  async function addMetricBlock(metric: MetricRow, role: "figure" | "exhibit") {
    if (!activeId || addingMetricId) return;
    setAddingMetricId(metric.id);
    setError(null);
    try {
      const res = await fetch(`${base}/reviews/${activeId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, metric_id: metric.id }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Add failed");
      }
      await loadReview(activeId);
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

  return (
    <div
      className="review-composer-layout"
      data-shelf={shelfOpen ? "open" : "collapsed"}
      style={{
        display: "grid",
        gridTemplateColumns: shelfOpen ? "200px minmax(0,1fr) 300px" : "200px minmax(0,1fr) 44px",
        gap: 20,
        maxWidth: 1640,
      }}
    >
      <aside className="panel p-3">
        <p className="sec-title text-sm mb-2">Issues</p>
        <div className="space-y-1 mb-3">
          {reviews.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`chip w-full text-left${activeId === r.id ? " on" : ""}`}
              onClick={() => void loadReview(r.id)}
            >
              {r.title || r.period_month}
              <span className="block text-xs opacity-70">
                {r.status.toUpperCase()}
                {r.current_version ? ` v${r.current_version}` : ""}
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="chip w-full" disabled={busy} onClick={() => void createDraft()}>
          New draft issue
        </button>
      </aside>

      <div>
        <div
          className="panel px-3 py-2 mb-3 sticky top-0 z-10"
          data-gate-level={gateLevel}
          style={{
            minHeight: 40,
            opacity: gateLevel === "quiet" ? 0.85 : 1,
            border:
              gateLevel === "ready" && status === "draft"
                ? "1px solid color-mix(in srgb, var(--su-accept, #2ecc71) 40%, var(--line))"
                : "1px solid var(--line)",
            background:
              gateLevel === "ready" && status === "draft"
                ? "color-mix(in srgb, var(--su-accept, #2ecc71) 7%, var(--rail, #fff))"
                : undefined,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{title || "Draft issue"}</span>
              <span className="treasury-meta text-xs">
                {preflight
                  ? `Proposed ${preflight.proposed_count} · Stale ${preflight.stale_count} · Envelope ${preflight.envelope_violations.length}`
                  : activeId
                    ? "Loading preflight…"
                    : "No draft issue"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="treasury-meta text-xs">
                {gateLevel === "quiet"
                  ? "Nothing to publish yet"
                  : publishBlocked
                    ? "Clean preflight to publish"
                    : status === "draft"
                      ? `Publish v${(reviews.find((r) => r.id === activeId)?.current_version ?? 0) + 1}`
                      : "Published"}
              </span>
              <button
                type="button"
                className={`btn sm${gateLevel === "ready" && status === "draft" ? "" : " ghost"}`}
                disabled={busy || status !== "draft" || publishBlocked}
                onClick={() => void publish()}
              >
                Publish
              </button>
            </div>
          </div>
          {preflight?.envelope_violations.length ? (
            <ul className="text-xs mt-2" style={{ color: "var(--su-neg)" }}>
              {preflight.envelope_violations.map((v, i) => (
                <li key={i}>{v.field}: {v.message}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? (
          <p className="panel-note mb-3" style={{ color: "var(--su-neg)" }} role="alert">
            {error}
          </p>
        ) : null}

        {!activeId ? (
          <p className="treasury-meta">Create or select a draft issue.</p>
        ) : (
          <>
            <div className="panel p-4 mb-3">
              <input
                className="rec-input w-full font-head text-lg mb-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  void saveTitle().catch((e) =>
                    setError(e instanceof Error ? e.message : "Title save failed")
                  );
                }}
              />
              <p className="treasury-meta text-xs">{status === "draft" ? "DRAFT" : status.toUpperCase()}</p>
            </div>

            <div className="space-y-3">
              {status === "draft" && blocks.length === 0 ? (
                <div
                  className="panel p-6 text-center"
                  style={{
                    border: "1px dashed var(--line)",
                    background: "color-mix(in srgb, var(--canvas, #f5f3ef) 50%, transparent)",
                  }}
                >
                  <p className="sec-title mb-2">Nothing placed yet</p>
                  <p className="treasury-meta text-sm mb-4">
                    Add a Figure, an Exhibit, or a Note. Everything you place stays on this
                    side until you publish.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setShelfOpen(true);
                        setError("Pick a value metric from the Shelf → Figure.");
                      }}
                    >
                      Add a Figure
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setShelfOpen(true);
                        setError("Pick an analytics metric from the Shelf → Exhibit.");
                      }}
                    >
                      Add an Exhibit
                    </button>
                    <button type="button" className="chip" onClick={() => void addNote()}>
                      Write a Note
                    </button>
                  </div>
                </div>
              ) : null}
              {blocks.map((block) => (
                <article key={block.id} className="panel p-4">
                  <div className="flex flex-wrap gap-2 mb-2 text-xs">
                    <span className="chip">{block.role}</span>
                    <span className="chip">{stateChip(block)}</span>
                    {block.metric_name ? (
                      <span className="treasury-meta">{block.metric_name}</span>
                    ) : null}
                  </div>
                  {block.role === "note" ? (
                    <p className="text-sm whitespace-pre-wrap mb-2">{block.body}</p>
                  ) : null}
                  {(block.role === "figure" || block.role === "exhibit") && (
                    <label className="block mb-2">
                      <span className="text-xs treasury-meta">Caption</span>
                      <textarea
                        className="rec-input w-full"
                        rows={2}
                        value={block.caption}
                        placeholder={block.suggested_caption ?? ""}
                        onChange={(e) =>
                          setBlocks((prev) =>
                            prev.map((b) =>
                              b.id === block.id ? { ...b, caption: e.target.value } : b
                            )
                          )
                        }
                        onBlur={() =>
                          void patchBlock(block.id, {
                            caption: block.caption,
                          }).catch((e) => setError(String(e.message)))
                        }
                      />
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {block.proposal_state === "proposed" ? (
                      <button
                        type="button"
                        className="chip"
                        onClick={() =>
                          void patchBlock(block.id, { action: "confirm_proposal" })
                        }
                      >
                        Confirm proposal
                      </button>
                    ) : null}
                    {(block.role === "figure" || block.role === "exhibit") && (
                      <button
                        type="button"
                        className="chip"
                        onClick={() =>
                          void patchBlock(block.id, { action: "recalculate" })
                        }
                      >
                        Recalculate
                      </button>
                    )}
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        if (!confirm("Remove block?")) return;
                        void fetch(`${base}/reviews/${activeId}/blocks/${block.id}`, {
                          method: "DELETE",
                        }).then(() => loadReview(activeId!));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="flex gap-2 mt-3">
              <button type="button" className="chip" onClick={() => void addNote()}>
                Add note
              </button>
            </div>
          </>
        )}
      </div>

      {shelfOpen ? (
        <aside className="panel p-3">
          <div className="flex justify-between items-center mb-2">
            <p className="sec-title text-sm mb-0">Shelf</p>
            <div className="flex gap-1">
              <button type="button" className="chip text-xs" onClick={() => setBuilderOpen((v) => !v)}>
                {builderOpen ? "Hide builder" : "Metric builder"}
              </button>
              <button type="button" className="chip text-xs" onClick={() => setShelfOpen(false)}>
                ›
              </button>
            </div>
          </div>
          {builderOpen ? (
            <div className="mb-3 max-h-96 overflow-auto">
              <MetricsTab clientUserId={clientUserId} dataThrough={dataThrough} />
            </div>
          ) : null}
          <p className="text-xs treasury-meta mb-2">Metric library</p>
          <div className="space-y-2 max-h-80 overflow-auto">
            {metrics.map((m) => (
              <div key={m.id} className="border border-[var(--line)] p-2 rounded">
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs treasury-meta">{m.kind}</p>
                <div className="flex gap-1 mt-1">
                  <button
                    type="button"
                    className="chip text-xs"
                    disabled={status !== "draft" || !!addingMetricId}
                    onClick={() => void addMetricBlock(m, "figure")}
                  >
                    Figure
                  </button>
                  <button
                    type="button"
                    className="chip text-xs"
                    disabled={status !== "draft" || !!addingMetricId}
                    onClick={() => void addMetricBlock(m, "exhibit")}
                  >
                    Exhibit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      ) : (
        <button
          type="button"
          className="panel p-2 text-xs"
          style={{ writingMode: "vertical-rl", minHeight: 120 }}
          onClick={() => setShelfOpen(true)}
        >
          Shelf · {metrics.length}
        </button>
      )}
    </div>
  );
}
