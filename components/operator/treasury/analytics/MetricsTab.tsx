"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MetricRow = {
  id: string;
  name: string;
  description: string;
  scope: string;
  source: string;
  definition: Record<string, unknown>;
  computed_value: { value?: number } | null;
  computed_at: string | null;
  version: number;
  client_user_id: string | null;
};

type DefinitionDraft = {
  of: "monthly_totals";
  source: {
    type: "bucket" | "category" | "account" | "metric";
    key?: string;
    direction?: "in" | "out" | "any";
    ref?: string;
  };
  op: "avg" | "sum" | "stddev" | "min" | "max" | "yoy" | "count" | "pct_of";
  window: {
    kind: "trailing" | "calendar_year" | "ytd" | "all";
    months?: number;
  };
  of2?: DefinitionDraft;
};

type Props = {
  clientUserId: string;
  dataThrough?: string | null;
};

const OPS_GUIDED = ["avg", "sum", "stddev", "min", "max", "yoy", "count"] as const;
const SOURCE_TYPES = ["bucket", "category", "account", "metric"] as const;
const WINDOWS = ["trailing", "calendar_year", "ytd", "all"] as const;

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
        : d.window?.kind ?? "?";
    return `${d.op ?? "?"} of ${src}, ${win}`;
  } catch {
    return JSON.stringify(def).slice(0, 80);
  }
}

function emptyGuided(): DefinitionDraft {
  return {
    of: "monthly_totals",
    source: { type: "category", key: "", direction: "in" },
    op: "avg",
    window: { kind: "trailing", months: 3 },
  };
}

/** Spec B4 — full Metrics tab: list + guided/advanced builder. */
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
  const [guided, setGuided] = useState<DefinitionDraft>(emptyGuided);
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(emptyGuided(), null, 2)
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string | null>(null);

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

  function definitionFromUi(): unknown {
    if (mode === "advanced") {
      try {
        return JSON.parse(jsonText) as unknown;
      } catch {
        throw new Error("Invalid JSON");
      }
    }
    const d = { ...guided };
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
    return d;
  }

  function syncAdvancedFromGuided(next: DefinitionDraft) {
    setGuided(next);
    setJsonText(JSON.stringify(next, null, 2));
  }

  function openNew() {
    setEditingId(null);
    setName("");
    setDescription("");
    setScopeGeneral(false);
    setMode("guided");
    const g = emptyGuided();
    setGuided(g);
    setJsonText(JSON.stringify(g, null, 2));
    setPreview(null);
    setFieldErrors(null);
    setBuilderOpen(true);
  }

  function openEdit(row: MetricRow) {
    setEditingId(row.id);
    setName(row.name);
    setDescription(row.description ?? "");
    setScopeGeneral(row.scope === "general");
    setMode("advanced");
    setJsonText(JSON.stringify(row.definition ?? {}, null, 2));
    try {
      setGuided({ ...emptyGuided(), ...(row.definition as DefinitionDraft) });
    } catch {
      setGuided(emptyGuided());
    }
    setPreview(null);
    setFieldErrors(null);
    setBuilderOpen(true);
  }

  async function runPreview() {
    setFieldErrors(null);
    setPreview(null);
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
      const json = (await res.json()) as {
        value?: number;
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
      setPreview(formatValue(json.value));
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

  return (
    <div className="space-y-4" data-testid="metrics-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="sec-title mb-0">Metrics</p>
          <p className="treasury-meta text-sm">
            Derived variables for this client (platform + assistant).
          </p>
        </div>
        <button type="button" className="chip" onClick={openNew}>
          New metric
        </button>
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
              data-active={mode === "guided" ? "true" : undefined}
              onClick={() => {
                setMode("guided");
                setJsonText(JSON.stringify(guided, null, 2));
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
                setJsonText(JSON.stringify(guided, null, 2));
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
                <span className="treasury-meta">Op</span>
                <select
                  className="w-full border border-[var(--line)] rounded px-2 py-1 mt-1"
                  value={guided.op}
                  onChange={(e) =>
                    syncAdvancedFromGuided({
                      ...guided,
                      op: e.target.value as DefinitionDraft["op"],
                    })
                  }
                >
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
            </div>
          ) : (
            <div className="space-y-2">
              <p className="treasury-meta-fine text-xs">
                Grammar: of=monthly_totals · source.type=bucket|category|account|metric ·
                op=avg|sum|stddev|min|max|yoy|pct_of|count · window=trailing|calendar_year|ytd|all ·
                of2 for pct_of
              </p>
              <textarea
                className="w-full min-h-[180px] font-mono text-sm border border-[var(--line)] rounded p-2"
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  try {
                    const parsed = JSON.parse(e.target.value) as DefinitionDraft;
                    setGuided({ ...emptyGuided(), ...parsed });
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
          {preview != null ? (
            <p className="treasury-meta">
              Preview value: <strong>{preview}</strong>
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="chip"
              disabled={busy === "preview" || busy === "save"}
              onClick={() => void runPreview()}
            >
              Preview value
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

      <ul className="space-y-2">
        {rows.length === 0 ? (
          <li className="treasury-meta text-sm">No metrics yet.</li>
        ) : (
          rows.map((row) => {
            const value = formatValue(row.computed_value?.value);
            const stale = isStale(row.computed_at);
            const sourceLabel = row.source === "mcp" ? "assistant" : "platform";
            return (
              <li
                key={row.id}
                className="panel p-3 space-y-2"
                style={{ border: "1px solid var(--line)" }}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="font-medium mb-0">{row.name}</p>
                  <span className="chip text-xs">{row.scope}</span>
                  <span className="chip text-xs">{sourceLabel}</span>
                  {stale ? <span className="chip text-xs">Stale</span> : null}
                </div>
                <p className="treasury-meta text-sm mb-0">
                  {row.description || "—"}
                </p>
                <p className="treasury-meta-fine text-sm mb-0">
                  {summarizeDefinition(row.definition)}
                </p>
                <p className="treasury-meta text-sm mb-0">
                  Value <strong>{value}</strong>
                  {row.computed_at
                    ? ` · ${new Date(row.computed_at).toLocaleString()}`
                    : " · not computed"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === row.id}
                    onClick={() => void runCompute(row.id)}
                  >
                    Compute
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
          })
        )}
      </ul>
    </div>
  );
}
