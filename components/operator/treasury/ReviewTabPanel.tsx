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

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await loadReviews();
      const draft = list.find((r) => r.status === "draft") ?? list[0];
      if (draft) await loadReview(draft.id);
      await loadMetrics();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [loadReviews, loadReview, loadMetrics]);

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
      const json = (await res.json()) as { review?: ReviewItem; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      await refresh();
      if (json.review) await loadReview(json.review.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function addMetricBlock(metric: MetricRow, role: "figure" | "exhibit") {
    if (!activeId) return;
    setBusy(true);
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
      setBusy(false);
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
        throw new Error(json.error ?? "Publish blocked");
      }
      await refresh();
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

  return (
    <div className="review-composer-layout" style={{ display: "grid", gridTemplateColumns: shelfOpen ? "200px 1fr 240px" : "200px 1fr", gap: 12 }}>
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
          className="panel p-3 mb-3 sticky top-0 z-10"
          style={{ border: publishBlocked ? "1px solid var(--line)" : "1px solid #2ecc71" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="sec-title mb-0">Publish gate</p>
              <p className="treasury-meta text-xs">
                {preflight
                  ? `Proposed ${preflight.proposed_count} · Stale ${preflight.stale_count} · Envelope ${preflight.envelope_violations.length}`
                  : "Loading preflight…"}
              </p>
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy || status !== "draft" || publishBlocked}
              onClick={() => void publish()}
            >
              Publish
            </button>
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
                  if (status !== "draft") return;
                  void fetch(`${base}/reviews/${activeId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title }),
                  });
                }}
              />
              <p className="treasury-meta text-xs">{status === "draft" ? "DRAFT" : status.toUpperCase()}</p>
            </div>

            <div className="space-y-3">
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
            <button type="button" className="chip text-xs" onClick={() => setBuilderOpen((v) => !v)}>
              {builderOpen ? "Hide builder" : "Metric builder"}
            </button>
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
                    disabled={busy || status !== "draft"}
                    onClick={() => void addMetricBlock(m, "figure")}
                  >
                    Figure
                  </button>
                  <button
                    type="button"
                    className="chip text-xs"
                    disabled={busy || status !== "draft"}
                    onClick={() => void addMetricBlock(m, "exhibit")}
                  >
                    Exhibit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
