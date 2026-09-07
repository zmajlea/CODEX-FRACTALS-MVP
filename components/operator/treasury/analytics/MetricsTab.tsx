"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MetricChart,
  type MetricChartPoint,
  type MetricChartRefLine,
} from "@/components/operator/treasury/analytics/MetricChart";
import { MetricComparisonChart } from "@/components/operator/treasury/analytics/MetricComparisonChart";
import {
  MetricSentenceWizard,
  autoNameFromSentence,
  definitionFromSentence,
  emptySentenceDraft,
  sentenceFromDefinition,
  type SentenceDraft,
} from "@/components/operator/treasury/analytics/MetricSentenceWizard";
import type { MetricComparison } from "@/lib/treasury/metrics-eval";

type MetricSeriesEnvelope = {
  v?: number;
  unit?: string;
  subdivision?: string;
  window?: { start: string; end: string };
  points?: MetricChartPoint[];
  reference_lines?: MetricChartRefLine[];
  summary?: { op: string; value: number; breach_count?: number };
  chart_hint?: "column" | "line";
  value?: number;
};

type MetricRow = {
  id: string;
  name: string;
  description: string;
  scope: string;
  source: string;
  kind?: string;
  definition: Record<string, unknown>;
  computed_value:
    | (MetricSeriesEnvelope & { value?: number })
    | (MetricComparison & { value?: number })
    | null;
  computed_at: string | null;
  version: number;
  client_user_id: string | null;
};

type Props = {
  clientUserId: string;
  dataThrough?: string | null;
};

const PREVIEW_DEBOUNCE_MS = 250;

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isAnalyticsEnvelope(
  cv: MetricRow["computed_value"]
): cv is MetricSeriesEnvelope & { points: MetricChartPoint[] } {
  return !!cv && cv.v === 2 && Array.isArray(cv.points);
}

function isComparisonEnvelope(
  cv: MetricRow["computed_value"]
): cv is MetricComparison & { value?: number } {
  return !!cv && cv.v === 3 && Array.isArray((cv as MetricComparison).groups);
}

function rowKind(row: MetricRow): "value" | "analytics" | "comparison" {
  if (row.kind === "comparison") return "comparison";
  if (row.kind === "analytics" || row.kind === "value") return row.kind;
  if (row.definition?.of === "series_compare") return "comparison";
  return row.definition?.subdivision ? "analytics" : "value";
}

function scalarFromRow(row: MetricRow): number | undefined {
  const cv = row.computed_value;
  if (!cv) return undefined;
  if (typeof cv.value === "number") return cv.value;
  if (isAnalyticsEnvelope(cv) && typeof cv.summary?.value === "number") {
    return cv.summary.value;
  }
  if (isComparisonEnvelope(cv) && typeof cv.summary?.value === "number") {
    return cv.summary.value;
  }
  return undefined;
}

function summarizeDefinition(def: unknown): string {
  if (!def || typeof def !== "object") return "—";
  const d = def as {
    source?: { type?: string; key?: string; ref?: string; direction?: string };
    window?: { kind?: string; months?: number };
    subdivision?: string;
    bucket_op?: string;
    op?: string;
    of?: string;
    compare?: { by?: string };
  };
  try {
    const src =
      d.source?.type === "metric"
        ? `metric “${d.source.ref ?? "?"}”`
        : `${d.source?.type ?? "?"} “${d.source?.key ?? "any"}” (${d.source?.direction ?? "any"})`;
    const win =
      d.window?.kind === "trailing"
        ? `trailing ${d.window.months ?? "?"} mo`
        : (d.window?.kind ?? "?");
    if (d.of === "series_compare" || d.compare) {
      return `${d.bucket_op ?? "sum"} by ${d.subdivision ?? "?"} of ${src}, ${win} · vs ${d.compare?.by ?? "?"}`;
    }
    if (d.subdivision) {
      return `${d.bucket_op ?? "sum"} by ${d.subdivision} of ${src}, ${win}${d.op ? ` · summary ${d.op}` : ""}`;
    }
    return `${d.op ?? "?"} of ${src}, ${win}`;
  } catch {
    return JSON.stringify(def).slice(0, 80);
  }
}

/** Spec B5/B18 — Metrics tab: sentence composer + live preview + saved list. */
export function MetricsTab({ clientUserId, dataThrough }: Props) {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"guided" | "advanced">("guided");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeGeneral, setScopeGeneral] = useState(false);
  const [sentence, setSentence] = useState<SentenceDraft>(() => emptySentenceDraft());
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(definitionFromSentence(emptySentenceDraft()), null, 2)
  );
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [previewSeries, setPreviewSeries] = useState<MetricSeriesEnvelope | null>(
    null
  );
  const [previewComparison, setPreviewComparison] = useState<MetricComparison | null>(
    null
  );
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedBoardLink, setSavedBoardLink] = useState<string | null>(null);
  const previewGen = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/metrics`
    );
    if (!res.ok) return;
    const json = (await res.json()) as { metrics?: MetricRow[] };
    setRows(json.metrics ?? []);
  }, [clientUserId]);

  const loadLabels = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/labels`
    );
    if (!res.ok) return;
    const json = (await res.json()) as { labels?: string[] };
    setLabels(json.labels ?? []);
  }, [clientUserId]);

  useEffect(() => {
    void load();
    void loadLabels();
  }, [load, loadLabels]);

  const metricNames = useMemo(() => rows.map((r) => r.name), [rows]);
  const valueRows = useMemo(
    () => rows.filter((r) => rowKind(r) === "value"),
    [rows]
  );
  const analyticsRows = useMemo(
    () => rows.filter((r) => rowKind(r) === "analytics"),
    [rows]
  );
  const comparisonRows = useMemo(
    () => rows.filter((r) => rowKind(r) === "comparison"),
    [rows]
  );

  const resolvedDefinition = useMemo(() => {
    if (mode === "advanced") {
      try {
        return JSON.parse(jsonText) as unknown;
      } catch {
        return null;
      }
    }
    return definitionFromSentence(sentence);
  }, [mode, jsonText, sentence]);

  function definitionFromUi(): unknown {
    if (mode === "advanced") {
      return JSON.parse(jsonText) as unknown;
    }
    return definitionFromSentence(sentence);
  }

  function syncSentence(next: SentenceDraft) {
    setSentence(next);
    setJsonText(JSON.stringify(definitionFromSentence(next), null, 2));
  }

  function openNew() {
    setEditingId(null);
    setDescription("");
    setScopeGeneral(false);
    setMode("guided");
    const g = emptySentenceDraft();
    setSentence(g);
    const def = definitionFromSentence(g);
    setJsonText(JSON.stringify(def, null, 2));
    setName(autoNameFromSentence(g));
    setPreviewLabel(null);
    setPreviewSeries(null);
    setPreviewComparison(null);
    setPreviewMs(null);
    setFieldErrors(null);
    setBuilderOpen(true);
  }

  function openEdit(row: MetricRow) {
    setEditingId(row.id);
    setName(row.name);
    setDescription(row.description ?? "");
    setScopeGeneral(row.scope === "general");
    setMode("guided");
    setJsonText(JSON.stringify(row.definition ?? {}, null, 2));
    setSentence(sentenceFromDefinition(row.definition));
    setPreviewLabel(null);
    setPreviewSeries(null);
    setPreviewComparison(null);
    setPreviewMs(null);
    setFieldErrors(null);
    setBuilderOpen(true);
  }

  const runPreview = useCallback(
    async (definition: unknown) => {
      const gen = ++previewGen.current;
      setBusy("preview");
      const t0 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/metrics/preview`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ definition }),
          }
        );
        const json = (await res.json()) as
          | (MetricSeriesEnvelope & { value?: number })
          | (MetricComparison & { value?: number })
          | {
              errors?: Array<{ path: string; message: string }>;
              error?: string;
              value?: number;
            };
        if (gen !== previewGen.current) return;
        const elapsed = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            t0
        );
        setPreviewMs(elapsed);
        if (!res.ok) {
          const errJson = json as {
            errors?: Array<{ path: string; message: string }>;
            error?: string;
          };
          setFieldErrors(
            errJson.errors?.map((e) => `${e.path}: ${e.message}`).join("; ") ??
              errJson.error ??
              "Preview failed"
          );
          setPreviewLabel(null);
          setPreviewSeries(null);
          setPreviewComparison(null);
          return;
        }
        setFieldErrors(null);
        if (
          "v" in json &&
          json.v === 3 &&
          "groups" in json &&
          Array.isArray(json.groups)
        ) {
          setPreviewComparison(json as MetricComparison);
          setPreviewSeries(null);
          setPreviewLabel(
            `${json.groups.length} groups · ${json.axis.labels.length} periods`
          );
        } else if (
          "v" in json &&
          json.v === 2 &&
          "points" in json &&
          Array.isArray(json.points)
        ) {
          setPreviewSeries(
            json as MetricSeriesEnvelope & { points: MetricChartPoint[] }
          );
          setPreviewComparison(null);
          setPreviewLabel(
            json.summary
              ? `summary ${json.summary.op}=${formatValue(json.summary.value)}`
              : `${json.points.length} points`
          );
        } else {
          setPreviewSeries(null);
          setPreviewComparison(null);
          setPreviewLabel(formatValue(json.value));
        }
      } catch (e) {
        if (gen !== previewGen.current) return;
        setFieldErrors(e instanceof Error ? e.message : "Preview failed");
        setPreviewSeries(null);
        setPreviewComparison(null);
        setPreviewLabel(null);
      } finally {
        if (gen === previewGen.current) setBusy(null);
      }
    },
    [clientUserId]
  );

  // Live preview — debounce ~250ms whenever the resolved definition changes.
  useEffect(() => {
    if (!builderOpen) return;
    if (resolvedDefinition == null) {
      setFieldErrors("Invalid JSON");
      return;
    }
    const handle = window.setTimeout(() => {
      void runPreview(resolvedDefinition);
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [builderOpen, resolvedDefinition, runPreview]);

  async function runSave() {
    setFieldErrors(null);
    setBusy("save");
    try {
      const definition = definitionFromUi();
      if (editingId) {
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/metrics/${editingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, definition }),
          }
        );
        const json = (await res.json()) as {
          error?: string;
          fieldErrors?: Array<{ path: string; message: string }>;
        };
        if (!res.ok) {
          setFieldErrors(
            json.fieldErrors?.map((e) => `${e.path}: ${e.message}`).join("; ") ??
              json.error ??
              "Save failed"
          );
          return;
        }
      } else {
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/metrics`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              description,
              definition,
              scope: scopeGeneral ? "general" : "client",
            }),
          }
        );
        const json = (await res.json()) as {
          error?: string;
          fieldErrors?: Array<{ path: string; message: string }>;
        };
        if (!res.ok) {
          setFieldErrors(
            json.fieldErrors?.map((e) => `${e.path}: ${e.message}`).join("; ") ??
              json.error ??
              "Save failed"
          );
          return;
        }
      }
      setBuilderOpen(false);
      await load();
    } catch (e) {
      setFieldErrors(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function runCompute(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/metrics/${id}/compute`,
        { method: "POST" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Compute failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compute failed");
    } finally {
      setBusy(null);
    }
  }

  async function runRecalculateAll() {
    setBusy("recalc");
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/metrics/recalculate`,
        { method: "POST" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Recalculate failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recalculate failed");
    } finally {
      setBusy(null);
    }
  }

  async function runDiscard(id: string) {
    if (!confirm("Discard this metric?")) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/metrics/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Discard failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setBusy(null);
    }
  }

  function isStale(computedAt: string | null): boolean {
    if (!computedAt || !dataThrough) return false;
    return new Date(computedAt).getTime() < new Date(dataThrough).getTime();
  }

  function toggleExpand(row: MetricRow) {
    const kind = rowKind(row);
    if (kind !== "analytics" && kind !== "comparison") return;
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    const cv = row.computed_value;
    if (isAnalyticsEnvelope(cv) && cv.window) {
      setFilterFrom(cv.window.start);
      setFilterTo(cv.window.end);
    } else {
      setFilterFrom("");
      setFilterTo("");
    }
  }

  function filteredPoints(row: MetricRow): MetricChartPoint[] {
    const cv = row.computed_value;
    if (!isAnalyticsEnvelope(cv)) return [];
    return cv.points.filter((p) => {
      if (filterFrom && p.bucket_start < filterFrom) return false;
      if (filterTo && p.bucket_start > filterTo) return false;
      return true;
    });
  }

  function renderMetricCard(row: MetricRow) {
    const kind = rowKind(row);
    const value = formatValue(scalarFromRow(row));
    const stale = isStale(row.computed_at);
    const sourceLabel = row.source === "mcp" ? "assistant" : "platform";
    const expanded = expandedId === row.id;
    const envelope = isAnalyticsEnvelope(row.computed_value)
      ? row.computed_value
      : null;
    const comparison = isComparisonEnvelope(row.computed_value)
      ? row.computed_value
      : null;
    const points = expanded ? filteredPoints(row) : [];
    const calcLabel = row.computed_at ? "Recalculate" : "Calculate";

    return (
      <li
        key={row.id}
        className="panel p-3 space-y-2"
        style={{ border: "1px solid var(--line)" }}
        data-kind={kind}
      >
        <div
          className={kind === "analytics" || kind === "comparison" ? "cursor-pointer" : undefined}
          onClick={() => toggleExpand(row)}
          onKeyDown={(e) => {
            if ((kind === "analytics" || kind === "comparison") && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              toggleExpand(row);
            }
          }}
          role={kind === "analytics" || kind === "comparison" ? "button" : undefined}
          tabIndex={kind === "analytics" || kind === "comparison" ? 0 : undefined}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <label
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(row.id)}
                onChange={(e) => {
                  setSelectedIds((ids) =>
                    e.target.checked
                      ? [...ids, row.id]
                      : ids.filter((x) => x !== row.id)
                  );
                }}
              />
            </label>
            <p className="font-medium mb-0">{row.name}</p>
            <span className="chip text-xs">{row.scope}</span>
            <span className="chip text-xs">{sourceLabel}</span>
            <span className="chip text-xs">{kind}</span>
            {stale ? <span className="chip text-xs">Stale</span> : null}
            {envelope?.summary?.breach_count ? (
              <span className="chip text-xs">
                {envelope.summary.breach_count} breaches
              </span>
            ) : null}
          </div>
          <p className="treasury-meta text-sm mb-0">{row.description || "—"}</p>
          <p className="treasury-meta-fine text-sm mb-0">
            {summarizeDefinition(row.definition)}
          </p>
          <p className="treasury-meta text-sm mb-0">
            Value <strong>{value}</strong>
            {row.computed_at
              ? ` · ${new Date(row.computed_at).toLocaleString()}`
              : " · not computed"}
            {kind === "analytics" || kind === "comparison" ? (
              <span className="treasury-meta-fine">
                {" "}
                · {expanded ? "collapse" : "expand"}
              </span>
            ) : null}
          </p>
        </div>

        {expanded && envelope ? (
          <div
            className="space-y-3 pt-2"
            style={{ borderTop: "1px solid var(--line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap gap-3 items-end">
              <label className="block text-sm">
                <span className="treasury-meta">From</span>
                <input
                  type="date"
                  className="block border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="treasury-meta">To</span>
                <input
                  type="date"
                  className="block border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                />
              </label>
              <p className="treasury-meta text-sm mb-1">
                {points.length} buckets
                {envelope.summary
                  ? ` · ${envelope.summary.op} ${formatValue(envelope.summary.value)}`
                  : ""}
              </p>
            </div>
            <MetricChart
              points={points}
              referenceLines={envelope.reference_lines}
              chartHint={envelope.chart_hint ?? "column"}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="metric-series-table">
                <thead>
                  <tr className="treasury-meta text-left">
                    <th className="py-1 pr-2 font-normal">Bucket</th>
                    <th className="py-1 pr-2 font-normal">Value</th>
                    <th className="py-1 font-normal">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.bucket_start}>
                      <td className="py-0.5 pr-2">{p.bucket_label}</td>
                      <td className="py-0.5 pr-2">{formatValue(p.value)}</td>
                      <td className="py-0.5">
                        {p.partial ? "partial " : ""}
                        {p.breaches?.length
                          ? `breach:${p.breaches.join(",")}`
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {(envelope.reference_lines ?? []).map((r) => (
                    <tr key={r.id} className="treasury-meta">
                      <td className="py-0.5 pr-2">{r.label}</td>
                      <td className="py-0.5 pr-2">{formatValue(r.value)}</td>
                      <td className="py-0.5">{r.kind}</td>
                    </tr>
                  ))}
                  {envelope.summary ? (
                    <tr>
                      <td className="py-1 pr-2 font-medium">
                        Summary ({envelope.summary.op})
                      </td>
                      <td className="py-1 pr-2 font-medium">
                        {formatValue(envelope.summary.value)}
                      </td>
                      <td className="py-1">
                        {envelope.summary.breach_count
                          ? `${envelope.summary.breach_count} breaches`
                          : ""}
                      </td>
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}

        {expanded && comparison ? (
          <div
            className="space-y-3 pt-2"
            style={{ borderTop: "1px solid var(--line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <MetricComparisonChart comparison={comparison} />
          </div>
        ) : null}

        <div
          className="flex flex-wrap gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="chip"
            disabled={busy === row.id}
            onClick={() => void runCompute(row.id)}
          >
            {calcLabel}
          </button>
          <button
            type="button"
            className="chip"
            disabled={busy === row.id}
            onClick={() => openEdit(row)}
          >
            Edit
          </button>
          <button
            type="button"
            className="chip"
            disabled={busy === row.id}
            onClick={() => void runDiscard(row.id)}
          >
            Discard
          </button>
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-4" data-testid="metrics-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="sec-title mb-0">Metrics</p>
          <p className="treasury-meta text-sm">
            Derived variables for this client (platform + assistant).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="chip"
            disabled={selectedIds.length === 0}
            onClick={() => {
              setSaveTitle("");
              setSaveOpen(true);
            }}
          >
            Save as Analytics ({selectedIds.length})
          </button>
          <button
            type="button"
            className="chip"
            disabled={busy === "recalc" || rows.length === 0}
            onClick={() => void runRecalculateAll()}
          >
            Recalculate all
          </button>
          <button type="button" className="chip" onClick={openNew}>
            New metric
          </button>
        </div>
      </div>

      {error ? <p className="treasury-meta cm-err">{error}</p> : null}

      {saveOpen ? (
        <div
          className="panel p-3 space-y-2"
          style={{ border: "1px solid var(--line)" }}
        >
          <p className="sec-title mb-0">Save as Analytics</p>
          <label className="block text-sm">
            <span className="treasury-meta">Board title</span>
            <input
              className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="e.g. FFM Monthly Cash"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="chip"
              disabled={busy === "save-board" || !saveTitle.trim()}
              onClick={() => {
                void (async () => {
                  setBusy("save-board");
                  setError(null);
                  try {
                    const res = await fetch(
                      `/api/operator/treasury/clients/${clientUserId}/analytics`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          title: saveTitle.trim(),
                          metric_ids: selectedIds,
                        }),
                      }
                    );
                    if (!res.ok) {
                      const j = (await res.json()) as { error?: string };
                      throw new Error(j.error ?? "Save failed");
                    }
                    setSaveOpen(false);
                    setSelectedIds([]);
                    setSaveTitle("");
                    setSavedBoardLink(
                      `/operator/treasury/clients/${clientUserId}?tab=analytics&view=saved`
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              Create board
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {savedBoardLink ? (
        <p className="treasury-meta text-sm" role="status">
          Saved to Analytics —{" "}
          <a className="underline" href={savedBoardLink}>
            Open Saved Analytics →
          </a>
        </p>
      ) : null}

      {builderOpen ? (
        <MetricSentenceWizard
          draft={sentence}
          onChange={syncSentence}
          name={name}
          onNameChange={setName}
          description={description}
          onDescriptionChange={setDescription}
          scopeGeneral={scopeGeneral}
          onScopeGeneralChange={setScopeGeneral}
          showScope={!editingId}
          labels={labels}
          metricNames={metricNames}
          definition={resolvedDefinition ?? definitionFromSentence(sentence)}
          previewSeries={previewSeries}
          previewComparison={previewComparison}
          previewLabel={previewLabel}
          previewMs={previewMs}
          fieldErrors={fieldErrors}
          busy={busy}
          mode={mode}
          onModeChange={(m) => {
            if (m === "advanced") {
              setJsonText(
                JSON.stringify(definitionFromSentence(sentence), null, 2)
              );
            } else {
              try {
                const parsed = JSON.parse(jsonText) as Record<string, unknown>;
                setSentence(sentenceFromDefinition(parsed));
              } catch {
                /* keep sentence */
              }
            }
            setMode(m);
          }}
          jsonText={jsonText}
          onJsonTextChange={(text) => {
            setJsonText(text);
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              setSentence(sentenceFromDefinition(parsed));
            } catch {
              /* keep typing */
            }
          }}
          onSave={() => void runSave()}
          onCancel={() => setBuilderOpen(false)}
          editing={!!editingId}
        />
      ) : null}


      <div className="space-y-4">
        <section>
          <p className="sec-title mb-2">Value metrics</p>
          <ul className="space-y-2">
            {valueRows.length === 0 ? (
              <li className="treasury-meta text-sm">No value metrics.</li>
            ) : (
              valueRows.map(renderMetricCard)
            )}
          </ul>
        </section>
        <section>
          <p className="sec-title mb-2">Analytics metrics</p>
          <ul className="space-y-2">
            {analyticsRows.length === 0 ? (
              <li className="treasury-meta text-sm">No analytics metrics.</li>
            ) : (
              analyticsRows.map(renderMetricCard)
            )}
          </ul>
        </section>
        <section>
          <p className="sec-title mb-2">Comparison metrics</p>
          <ul className="space-y-2">
            {comparisonRows.length === 0 ? (
              <li className="treasury-meta text-sm">No comparison metrics.</li>
            ) : (
              comparisonRows.map(renderMetricCard)
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
