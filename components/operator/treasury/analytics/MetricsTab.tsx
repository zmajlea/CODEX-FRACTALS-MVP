"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MetricChart,
  type MetricChartPoint,
  type MetricChartRefLine,
} from "@/components/operator/treasury/analytics/MetricChart";

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
  computed_value: (MetricSeriesEnvelope & { value?: number }) | null;
  computed_at: string | null;
  version: number;
  client_user_id: string | null;
};

type RefLineDraft = {
  id: string;
  label: string;
  kind: "avg" | "min" | "max" | "target" | "threshold";
  value?: number;
  stat?: "avg" | "min" | "max" | "median";
  breach?: "none" | "flag";
};

type DefinitionDraft = {
  of: "monthly_totals" | "series_totals";
  source: {
    type: "bucket" | "category" | "account" | "metric";
    key?: string;
    direction?: "in" | "out" | "any";
    ref?: string;
  };
  op?: "avg" | "sum" | "stddev" | "min" | "max" | "yoy" | "count" | "pct_of";
  window: {
    kind: "trailing" | "calendar_year" | "ytd" | "all";
    months?: number;
  };
  of2?: DefinitionDraft;
  subdivision?: "day" | "week" | "month" | "quarter" | "year";
  bucket_op?: "sum" | "count" | "avg" | "min" | "max";
  reference_lines?: RefLineDraft[];
  chart_hint?: "column" | "line";
};

type Props = {
  clientUserId: string;
  dataThrough?: string | null;
};

const OPS_GUIDED = ["avg", "sum", "stddev", "min", "max", "yoy", "count"] as const;
const SOURCE_TYPES = ["bucket", "category", "account", "metric"] as const;
const WINDOWS = ["trailing", "calendar_year", "ytd", "all"] as const;
const SUBDIVISIONS = ["day", "week", "month", "quarter", "year"] as const;
const BUCKET_OPS = ["sum", "count", "avg", "min", "max"] as const;
const REF_KINDS = ["avg", "min", "max", "target", "threshold"] as const;
const REF_STATS = ["avg", "min", "max", "median"] as const;

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isAnalyticsEnvelope(
  cv: MetricRow["computed_value"]
): cv is MetricSeriesEnvelope & { points: MetricChartPoint[] } {
  return !!cv && cv.v === 2 && Array.isArray(cv.points);
}

function rowKind(row: MetricRow): "value" | "analytics" {
  if (row.kind === "analytics" || row.kind === "value") return row.kind;
  return row.definition?.subdivision ? "analytics" : "value";
}

function scalarFromRow(row: MetricRow): number | undefined {
  const cv = row.computed_value;
  if (!cv) return undefined;
  if (typeof cv.value === "number") return cv.value;
  if (isAnalyticsEnvelope(cv) && typeof cv.summary?.value === "number") {
    return cv.summary.value;
  }
  return undefined;
}

function summarizeDefinition(def: unknown): string {
  if (!def || typeof def !== "object") return "—";
  const d = def as DefinitionDraft;
  try {
    const src =
      d.source?.type === "metric"
        ? `metric “${d.source.ref ?? "?"}”`
        : `${d.source?.type ?? "?"} “${d.source?.key ?? "any"}” (${d.source?.direction ?? "any"})`;
    const win =
      d.window?.kind === "trailing"
        ? `trailing ${d.window.months ?? "?"} mo`
        : (d.window?.kind ?? "?");
    if (d.subdivision) {
      return `${d.bucket_op ?? "sum"} by ${d.subdivision} of ${src}, ${win}${d.op ? ` · summary ${d.op}` : ""}`;
    }
    return `${d.op ?? "?"} of ${src}, ${win}`;
  } catch {
    return JSON.stringify(def).slice(0, 80);
  }
}

function emptyGuided(kind: "value" | "analytics" = "value"): DefinitionDraft {
  if (kind === "analytics") {
    return {
      of: "series_totals",
      source: { type: "category", key: "", direction: "in" },
      op: "avg",
      window: { kind: "trailing", months: 3 },
      subdivision: "day",
      bucket_op: "sum",
      chart_hint: "column",
      reference_lines: [],
    };
  }
  return {
    of: "monthly_totals",
    source: { type: "category", key: "", direction: "in" },
    op: "avg",
    window: { kind: "trailing", months: 3 },
  };
}

function definitionFromGuided(guided: DefinitionDraft, kind: "value" | "analytics"): unknown {
  const d: DefinitionDraft = { ...guided };
  if (d.source.type === "metric") {
    d.source = { type: "metric", ref: d.source.ref, direction: d.source.direction };
  } else if (d.source.type === "account") {
    d.source = { type: "account", direction: d.source.direction ?? "any" };
  } else {
    d.source = {
      type: d.source.type,
      key: d.source.key,
      direction: d.source.direction ?? "any",
    };
  }
  if (kind === "value") {
    delete d.subdivision;
    delete d.bucket_op;
    delete d.reference_lines;
    delete d.chart_hint;
    d.of = "monthly_totals";
  } else {
    d.of = "series_totals";
    if (!d.subdivision) d.subdivision = "day";
    if (!d.bucket_op) d.bucket_op = "sum";
    if (!d.chart_hint) d.chart_hint = "column";
  }
  return d;
}

/** Spec B5 — Metrics tab: value + analytics groups, expand, recalculate. */
export function MetricsTab({ clientUserId, dataThrough }: Props) {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"guided" | "advanced">("guided");
  const [builderKind, setBuilderKind] = useState<"value" | "analytics">("value");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeGeneral, setScopeGeneral] = useState(false);
  const [guided, setGuided] = useState<DefinitionDraft>(() => emptyGuided("value"));
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(emptyGuided("value"), null, 2)
  );
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [previewSeries, setPreviewSeries] = useState<MetricSeriesEnvelope | null>(
    null
  );
  const [fieldErrors, setFieldErrors] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

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

  function definitionFromUi(): unknown {
    if (mode === "advanced") {
      return JSON.parse(jsonText) as unknown;
    }
    return definitionFromGuided(guided, builderKind);
  }

  function syncAdvancedFromGuided(next: DefinitionDraft) {
    setGuided(next);
    setJsonText(JSON.stringify(definitionFromGuided(next, builderKind), null, 2));
  }

  function setKind(next: "value" | "analytics") {
    setBuilderKind(next);
    const g = emptyGuided(next);
    setGuided(g);
    setJsonText(JSON.stringify(g, null, 2));
    setPreviewLabel(null);
    setPreviewSeries(null);
  }

  function openNew() {
    setEditingId(null);
    setName("");
    setDescription("");
    setScopeGeneral(false);
    setMode("guided");
    setBuilderKind("value");
    const g = emptyGuided("value");
    setGuided(g);
    setJsonText(JSON.stringify(g, null, 2));
    setPreviewLabel(null);
    setPreviewSeries(null);
    setFieldErrors(null);
    setBuilderOpen(true);
  }

  function openEdit(row: MetricRow) {
    setEditingId(row.id);
    setName(row.name);
    setDescription(row.description ?? "");
    setScopeGeneral(row.scope === "general");
    setMode("advanced");
    const k = rowKind(row);
    setBuilderKind(k);
    setJsonText(JSON.stringify(row.definition ?? {}, null, 2));
    try {
      setGuided({ ...emptyGuided(k), ...(row.definition as DefinitionDraft) });
    } catch {
      setGuided(emptyGuided(k));
    }
    setPreviewLabel(null);
    setPreviewSeries(null);
    setFieldErrors(null);
    setBuilderOpen(true);
  }

  async function runPreview() {
    setFieldErrors(null);
    setPreviewLabel(null);
    setPreviewSeries(null);
    setBusy("preview");
    try {
      const definition = definitionFromUi();
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/metrics/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition }),
        }
      );
      const json = (await res.json()) as MetricSeriesEnvelope & {
        errors?: Array<{ path: string; message: string }>;
        error?: string;
      };
      if (!res.ok) {
        setFieldErrors(
          json.errors?.map((e) => `${e.path}: ${e.message}`).join("; ") ??
            json.error ??
            "Preview failed"
        );
        return;
      }
      if (json.v === 2 && Array.isArray(json.points)) {
        setPreviewSeries(json);
        setPreviewLabel(
          json.summary
            ? `summary ${json.summary.op}=${formatValue(json.summary.value)}`
            : `${json.points.length} points`
        );
      } else {
        setPreviewLabel(formatValue(json.value));
      }
    } catch (e) {
      setFieldErrors(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

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
    if (rowKind(row) !== "analytics") return;
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
          className={kind === "analytics" ? "cursor-pointer" : undefined}
          onClick={() => toggleExpand(row)}
          onKeyDown={(e) => {
            if (kind === "analytics" && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              toggleExpand(row);
            }
          }}
          role={kind === "analytics" ? "button" : undefined}
          tabIndex={kind === "analytics" ? 0 : undefined}
        >
          <div className="flex flex-wrap items-baseline gap-2">
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
            {kind === "analytics" ? (
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

      {builderOpen ? (
        <div
          className="panel p-4 space-y-3"
          style={{ border: "1px solid var(--line)" }}
        >
          <p className="sec-title mb-0">
            {editingId ? "Edit metric" : "New metric"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="chip"
              data-active={builderKind === "value" ? "true" : undefined}
              onClick={() => setKind("value")}
            >
              Value
            </button>
            <button
              type="button"
              className="chip"
              data-active={builderKind === "analytics" ? "true" : undefined}
              onClick={() => setKind("analytics")}
            >
              Analytics
            </button>
            <button
              type="button"
              className="chip"
              data-active={mode === "guided" ? "true" : undefined}
              onClick={() => {
                setMode("guided");
                setJsonText(
                  JSON.stringify(definitionFromGuided(guided, builderKind), null, 2)
                );
              }}
            >
              Guided
            </button>
            <button
              type="button"
              className="chip"
              data-active={mode === "advanced" ? "true" : undefined}
              onClick={() => {
                setMode("advanced");
                setJsonText(
                  JSON.stringify(definitionFromGuided(guided, builderKind), null, 2)
                );
              }}
            >
              Advanced
            </button>
          </div>

          <label className="block text-sm">
            <span className="treasury-meta">Name</span>
            <input
              className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="treasury-meta">Description</span>
            <input
              className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {!editingId ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopeGeneral}
                onChange={(e) => setScopeGeneral(e.target.checked)}
              />
              <span className="treasury-meta">General (tenant-wide)</span>
            </label>
          ) : null}

          {mode === "guided" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="treasury-meta">Source type</span>
                <select
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={guided.source.type}
                  onChange={(e) =>
                    syncAdvancedFromGuided({
                      ...guided,
                      source: {
                        ...guided.source,
                        type: e.target.value as DefinitionDraft["source"]["type"],
                      },
                    })
                  }
                >
                  {SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {guided.source.type === "metric" ? (
                <label className="block text-sm">
                  <span className="treasury-meta">Metric ref</span>
                  <select
                    className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                    value={guided.source.ref ?? ""}
                    onChange={(e) =>
                      syncAdvancedFromGuided({
                        ...guided,
                        source: { ...guided.source, ref: e.target.value },
                      })
                    }
                  >
                    <option value="">Select…</option>
                    {metricNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : guided.source.type !== "account" ? (
                <label className="block text-sm">
                  <span className="treasury-meta">Key (category/bucket)</span>
                  <input
                    list="metric-label-options"
                    className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                    value={guided.source.key ?? ""}
                    onChange={(e) =>
                      syncAdvancedFromGuided({
                        ...guided,
                        source: { ...guided.source, key: e.target.value },
                      })
                    }
                  />
                  <datalist id="metric-label-options">
                    {labels.map((l) => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                </label>
              ) : null}
              <label className="block text-sm">
                <span className="treasury-meta">Direction</span>
                <select
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={guided.source.direction ?? "any"}
                  onChange={(e) =>
                    syncAdvancedFromGuided({
                      ...guided,
                      source: {
                        ...guided.source,
                        direction: e.target.value as "in" | "out" | "any",
                      },
                    })
                  }
                >
                  <option value="any">any</option>
                  <option value="in">in</option>
                  <option value="out">out</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="treasury-meta">
                  {builderKind === "analytics" ? "Summary op (optional)" : "Op"}
                </span>
                <select
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={guided.op ?? ""}
                  onChange={(e) =>
                    syncAdvancedFromGuided({
                      ...guided,
                      op: (e.target.value || undefined) as DefinitionDraft["op"],
                    })
                  }
                >
                  {builderKind === "analytics" ? (
                    <option value="">(none)</option>
                  ) : null}
                  {OPS_GUIDED.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="treasury-meta">Window</span>
                <select
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={guided.window.kind}
                  onChange={(e) =>
                    syncAdvancedFromGuided({
                      ...guided,
                      window: {
                        ...guided.window,
                        kind: e.target.value as DefinitionDraft["window"]["kind"],
                      },
                    })
                  }
                >
                  {WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              {guided.window.kind === "trailing" ? (
                <label className="block text-sm">
                  <span className="treasury-meta">Months</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                    value={guided.window.months ?? 3}
                    onChange={(e) =>
                      syncAdvancedFromGuided({
                        ...guided,
                        window: {
                          ...guided.window,
                          months: Number(e.target.value) || 3,
                        },
                      })
                    }
                  />
                </label>
              ) : null}

              {builderKind === "analytics" ? (
                <>
                  <label className="block text-sm">
                    <span className="treasury-meta">Subdivision</span>
                    <select
                      className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                      value={guided.subdivision ?? "day"}
                      onChange={(e) =>
                        syncAdvancedFromGuided({
                          ...guided,
                          subdivision: e.target
                            .value as DefinitionDraft["subdivision"],
                        })
                      }
                    >
                      {SUBDIVISIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="treasury-meta">Bucket op</span>
                    <select
                      className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                      value={guided.bucket_op ?? "sum"}
                      onChange={(e) =>
                        syncAdvancedFromGuided({
                          ...guided,
                          bucket_op: e.target.value as DefinitionDraft["bucket_op"],
                        })
                      }
                    >
                      {BUCKET_OPS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="treasury-meta">Chart</span>
                    <select
                      className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                      value={guided.chart_hint ?? "column"}
                      onChange={(e) =>
                        syncAdvancedFromGuided({
                          ...guided,
                          chart_hint: e.target.value as "column" | "line",
                        })
                      }
                    >
                      <option value="column">column</option>
                      <option value="line">line</option>
                    </select>
                  </label>
                  <div className="sm:col-span-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="treasury-meta text-sm">Reference lines</span>
                      <button
                        type="button"
                        className="chip text-xs"
                        onClick={() => {
                          const id = `line_${(guided.reference_lines?.length ?? 0) + 1}`;
                          syncAdvancedFromGuided({
                            ...guided,
                            reference_lines: [
                              ...(guided.reference_lines ?? []),
                              {
                                id,
                                label: "Max",
                                kind: "max",
                                value: 0,
                                breach: "none",
                              },
                            ],
                          });
                        }}
                      >
                        Add line
                      </button>
                    </div>
                    {(guided.reference_lines ?? []).map((line, idx) => (
                      <div
                        key={line.id}
                        className="grid gap-2 sm:grid-cols-5 items-end"
                      >
                        <label className="block text-sm">
                          <span className="treasury-meta">Label</span>
                          <input
                            className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                            value={line.label}
                            onChange={(e) => {
                              const next = [...(guided.reference_lines ?? [])];
                              next[idx] = { ...line, label: e.target.value };
                              syncAdvancedFromGuided({
                                ...guided,
                                reference_lines: next,
                              });
                            }}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="treasury-meta">Kind</span>
                          <select
                            className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                            value={line.kind}
                            onChange={(e) => {
                              const next = [...(guided.reference_lines ?? [])];
                              next[idx] = {
                                ...line,
                                kind: e.target.value as RefLineDraft["kind"],
                              };
                              syncAdvancedFromGuided({
                                ...guided,
                                reference_lines: next,
                              });
                            }}
                          >
                            {REF_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="treasury-meta">Mode</span>
                          <select
                            className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                            value={line.stat !== undefined ? "stat" : "value"}
                            onChange={(e) => {
                              const next = [...(guided.reference_lines ?? [])];
                              if (e.target.value === "stat") {
                                const { value: _v, ...rest } = line;
                                next[idx] = { ...rest, stat: "avg" };
                              } else {
                                const { stat: _s, ...rest } = line;
                                next[idx] = { ...rest, value: 0 };
                              }
                              syncAdvancedFromGuided({
                                ...guided,
                                reference_lines: next,
                              });
                            }}
                          >
                            <option value="value">static</option>
                            <option value="stat">computed</option>
                          </select>
                        </label>
                        {line.stat !== undefined ? (
                          <label className="block text-sm">
                            <span className="treasury-meta">Stat</span>
                            <select
                              className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                              value={line.stat}
                              onChange={(e) => {
                                const next = [...(guided.reference_lines ?? [])];
                                next[idx] = {
                                  ...line,
                                  stat: e.target.value as RefLineDraft["stat"],
                                };
                                syncAdvancedFromGuided({
                                  ...guided,
                                  reference_lines: next,
                                });
                              }}
                            >
                              {REF_STATS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="block text-sm">
                            <span className="treasury-meta">Value</span>
                            <input
                              type="number"
                              className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                              value={line.value ?? 0}
                              onChange={(e) => {
                                const next = [...(guided.reference_lines ?? [])];
                                next[idx] = {
                                  ...line,
                                  value: Number(e.target.value),
                                };
                                syncAdvancedFromGuided({
                                  ...guided,
                                  reference_lines: next,
                                });
                              }}
                            />
                          </label>
                        )}
                        <label className="flex items-center gap-2 text-sm pb-1">
                          <input
                            type="checkbox"
                            checked={line.breach === "flag"}
                            onChange={(e) => {
                              const next = [...(guided.reference_lines ?? [])];
                              next[idx] = {
                                ...line,
                                breach: e.target.checked ? "flag" : "none",
                              };
                              syncAdvancedFromGuided({
                                ...guided,
                                reference_lines: next,
                              });
                            }}
                          />
                          <span className="treasury-meta">Flag breach</span>
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="treasury-meta-fine text-xs">
                Value: of=monthly_totals · op required · no subdivision. Analytics:
                of=series_totals · subdivision · bucket_op · reference_lines ·
                chart_hint · op optional.
              </p>
              <textarea
                className="w-full min-h-[180px] font-mono text-sm border border-[var(--line)] rounded p-2"
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  try {
                    const parsed = JSON.parse(e.target.value) as DefinitionDraft;
                    setGuided({ ...emptyGuided(builderKind), ...parsed });
                    if (parsed.subdivision) setBuilderKind("analytics");
                    else setBuilderKind("value");
                  } catch {
                    /* keep typing */
                  }
                }}
              />
            </div>
          )}

          {fieldErrors ? (
            <p className="treasury-meta cm-err">{fieldErrors}</p>
          ) : null}
          {previewLabel != null ? (
            <p className="treasury-meta">
              Preview: <strong>{previewLabel}</strong>
            </p>
          ) : null}
          {previewSeries?.points ? (
            <div className="space-y-2">
              <MetricChart
                points={previewSeries.points}
                referenceLines={previewSeries.reference_lines}
                chartHint={previewSeries.chart_hint ?? "column"}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="chip"
              disabled={busy === "preview" || busy === "save"}
              onClick={() => void runPreview()}
            >
              Preview
            </button>
            <button
              type="button"
              className="chip"
              disabled={busy === "preview" || busy === "save" || !name.trim()}
              onClick={() => void runSave()}
            >
              Save
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setBuilderOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
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
      </div>
    </div>
  );
}
