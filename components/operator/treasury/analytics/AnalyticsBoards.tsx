"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";

type BoardListRow = {
  id: string;
  title: string;
  description?: string;
  status: string;
  shared_at: string | null;
  metric_count?: number;
  items?: unknown[];
};

type Assembled = {
  board: {
    id: string;
    title: string;
    description: string;
    status: string;
    shared_at: string | null;
  };
  as_of: string;
  items: Array<{
    metric_id: string;
    note?: string;
    missing?: boolean;
    metric?: {
      id: string;
      name: string;
      description: string;
      kind: string;
    };
    computed?: {
      kind: "value" | "analytics";
      value?: number;
      series?: {
        points: Array<{
          bucket_start: string;
          bucket_label: string;
          value: number;
          partial?: true;
          breaches?: string[];
        }>;
        reference_lines?: Array<{
          id: string;
          label: string;
          value: number;
          kind: string;
        }>;
        summary?: { op: string; value: number; breach_count?: number };
        chart_hint?: "column" | "line";
      };
      computed_at: string;
    };
  }>;
};

type MetricOption = { id: string; name: string };

type Props = {
  clientUserId: string;
  /** Optional — if omitted, boards self-load metrics for Edit (Spec B8). */
  metrics?: MetricOption[];
  onBoardsChange?: () => void;
};

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Spec B7/B8 — operator boards list + open/edit/share/print export. */
export function AnalyticsBoards({
  clientUserId,
  metrics: metricsProp,
  onBoardsChange,
}: Props) {
  const [boards, setBoards] = useState<BoardListRow[]>([]);
  const [metricsLocal, setMetricsLocal] = useState<MetricOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [assembled, setAssembled] = useState<Assembled | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editIds, setEditIds] = useState<string[]>([]);

  const metrics = metricsProp ?? metricsLocal;

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/analytics`
    );
    if (!res.ok) return;
    const json = (await res.json()) as { boards?: BoardListRow[] };
    setBoards(json.boards ?? []);
  }, [clientUserId]);

  const loadMetrics = useCallback(async () => {
    if (metricsProp) return;
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/metrics`
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      metrics?: Array<{ id: string; name: string }>;
    };
    setMetricsLocal(
      (json.metrics ?? []).map((m) => ({ id: m.id, name: m.name }))
    );
  }, [clientUserId, metricsProp]);

  useEffect(() => {
    void load();
    void loadMetrics();
  }, [load, loadMetrics]);

  async function openBoard(id: string) {
    setBusy(id);
    setError(null);
    setEditing(false);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/analytics/${id}`
      );
      const json = (await res.json()) as Assembled & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load board");
      setAssembled(json);
      setOpenId(id);
      setEditTitle(json.board.title);
      setEditIds(json.items.map((i) => i.metric_id).filter(Boolean));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open");
    } finally {
      setBusy(null);
    }
  }

  async function runShare(id: string, share: boolean) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/analytics/${id}/${share ? "share" : "unshare"}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Share failed");
      }
      await load();
      if (openId === id) await openBoard(id);
      onBoardsChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Share failed");
    } finally {
      setBusy(null);
    }
  }

  async function runArchive(id: string) {
    if (!confirm("Archive this Analytics board?")) return;
    setBusy(id);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/analytics/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Archive failed");
      if (openId === id) {
        setOpenId(null);
        setAssembled(null);
      }
      await load();
      onBoardsChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setBusy(null);
    }
  }

  async function runSaveEdit() {
    if (!openId) return;
    setBusy("save");
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/analytics/${openId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: editTitle, metric_ids: editIds }),
        }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Save failed");
      }
      setEditing(false);
      await openBoard(openId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  /** Spec B8 Path C — open print-ready HTML; operator Save as PDF. */
  function runExport(id: string) {
    const url = `/api/operator/treasury/clients/${clientUserId}/analytics/${id}/export`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function moveId(idx: number, dir: -1 | 1) {
    const next = [...editIds];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    const tmp = next[idx]!;
    next[idx] = next[j]!;
    next[j] = tmp;
    setEditIds(next);
  }

  return (
    <div className="space-y-3" data-testid="analytics-boards">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="sec-title mb-0">Analytics boards</p>
        <p className="treasury-meta text-sm mb-0">
          Curate metrics → Share with client.
        </p>
      </div>
      {error ? <p className="treasury-meta cm-err">{error}</p> : null}

      <ul className="space-y-2">
        {boards.length === 0 ? (
          <li className="treasury-meta text-sm">No boards yet.</li>
        ) : (
          boards.map((b) => {
            const count =
              b.metric_count ??
              (Array.isArray(b.items) ? b.items.length : undefined);
            return (
              <li
                key={b.id}
                className="panel p-3 space-y-2"
                style={{ border: "1px solid var(--line)" }}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-medium mb-0">{b.title}</p>
                  <span className="chip text-xs">
                    {b.status === "shared" ? "Shared" : "Draft"}
                  </span>
                  {count != null ? (
                    <span className="treasury-meta text-xs">{count} metrics</span>
                  ) : null}
                  {b.shared_at ? (
                    <span className="treasury-meta text-xs">
                      {new Date(b.shared_at).toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === b.id}
                    onClick={() => void openBoard(b.id)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === b.id}
                    onClick={() => void runShare(b.id, b.status !== "shared")}
                  >
                    {b.status === "shared" ? "Unshare" : "Share"}
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => runExport(b.id)}
                  >
                    Export PDF
                  </button>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === b.id}
                    onClick={() => void runArchive(b.id)}
                  >
                    Archive
                  </button>
                </div>
                {b.status === "shared" ? (
                  <p className="treasury-meta-fine text-xs mb-0">
                    Shared with client · /client/treasury
                  </p>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {assembled && openId ? (
        <div
          className="panel p-4 space-y-3"
          style={{ border: "1px solid var(--line)" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="sec-title mb-0">{assembled.board.title}</p>
              <p className="treasury-meta text-sm mb-0">
                As of {assembled.as_of} · Reviewed by your Summit operator
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="chip"
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? "Cancel edit" : "Edit"}
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => runExport(openId)}
              >
                Export PDF
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setOpenId(null);
                  setAssembled(null);
                }}
              >
                Close
              </button>
            </div>
          </div>

          {editing ? (
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="treasury-meta">Title</span>
                <input
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </label>
              <ul className="space-y-1">
                {editIds.map((id, idx) => {
                  const m = metrics.find((x) => x.id === id);
                  return (
                    <li
                      key={id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span>{m?.name ?? id}</span>
                      <button
                        type="button"
                        className="chip text-xs"
                        onClick={() => moveId(idx, -1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="chip text-xs"
                        onClick={() => moveId(idx, 1)}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="chip text-xs"
                        onClick={() =>
                          setEditIds((ids) => ids.filter((x) => x !== id))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              <label className="block text-sm">
                <span className="treasury-meta">Add metric</span>
                <select
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !editIds.includes(id)) {
                      setEditIds((ids) => [...ids, id]);
                    }
                  }}
                >
                  <option value="">Select…</option>
                  {metrics
                    .filter((m) => !editIds.includes(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="chip"
                disabled={busy === "save" || !editTitle.trim() || !editIds.length}
                onClick={() => void runSaveEdit()}
              >
                Save changes
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {assembled.items.map((it) => (
                <div key={it.metric_id} className="space-y-1">
                  <p className="font-medium mb-0">
                    {it.metric?.name ?? "Unavailable"}
                  </p>
                  <p className="treasury-meta text-sm mb-0">
                    {it.metric?.description || "—"}
                  </p>
                  {it.missing || !it.computed ? (
                    <p className="treasury-meta cm-err text-sm">Unavailable</p>
                  ) : it.computed.kind === "analytics" && it.computed.series ? (
                    <>
                      {it.computed.series.summary ? (
                        <p className="treasury-meta text-sm">
                          {it.computed.series.summary.op}{" "}
                          <strong>
                            {formatValue(it.computed.series.summary.value)}
                          </strong>
                        </p>
                      ) : null}
                      <MetricChart
                        points={it.computed.series.points}
                        referenceLines={it.computed.series.reference_lines}
                        chartHint={it.computed.series.chart_hint ?? "column"}
                      />
                    </>
                  ) : (
                    <p className="text-lg">
                      <strong>{formatValue(it.computed.value)}</strong>
                    </p>
                  )}
                </div>
              ))}
              <p className="treasury-meta-fine text-xs">
                Advisory only. Figures reflect your ledger as of the last
                import. Reviewed and shared by your Summit operator.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
