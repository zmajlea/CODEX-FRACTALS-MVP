"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MetricChart,
  type MetricChartPoint,
  type MetricChartRefLine,
} from "@/components/operator/treasury/analytics/MetricChart";
import { MetricComparisonChart } from "@/components/operator/treasury/analytics/MetricComparisonChart";
import { MetricsTab } from "@/components/operator/treasury/analytics/MetricsTab";
import { ModelStudio } from "@/components/operator/treasury/ModelStudio";
import { TreasuryDateRangePicker } from "@/components/operator/treasury/TreasuryDateRangePicker";
import { getModelKind } from "@/lib/treasury/model-kinds";
import type { MetricComparison } from "@/lib/treasury/metrics-eval";
import { subtractMonths, todayIso } from "@/lib/treasury/period-bounds";
import type { TreasuryDateRange } from "@/lib/treasury/types";

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
  kind?: string;
  computed_value:
    | (MetricSeriesEnvelope & { value?: number })
    | (MetricComparison & { value?: number })
    | null;
  computed_at: string | null;
  updated_at?: string;
  client_user_id: string | null;
};

type ModelRow = {
  id: string;
  name: string;
  type: string;
  status?: string | null;
  params?: unknown;
  scenarios?: unknown;
  scope?: { accountId?: string; label?: string | null } | null;
  derived_snapshot?: unknown;
  updated_at?: string;
};

type RunTarget =
  | { kind: "metric"; id: string; name: string }
  | { kind: "model"; id: string; name: string };

type ModelRunResult = {
  snapshot: {
    assumptions?: string[];
    method_note?: string;
    confidence?: { grade: string; note?: string };
    kpis?: Array<{ label: string; value: number | string; unit?: string }>;
  };
  confidence?: { grade: string; note?: string };
  explain?: string;
};

type Props = {
  clientUserId: string;
  clientName: string;
};

const GRADE_LABEL: Record<string, string> = {
  solid: "Solid",
  indicative: "Indicative",
  thin: "Thin",
  refused: "Refused",
};

function defaultTrailing12(): TreasuryDateRange {
  const to = todayIso();
  return { from: subtractMonths(to, 12), to, preset: "12m" };
}

function gradeOf(derived: unknown): string | null {
  if (derived && typeof derived === "object") {
    const g = (derived as { confidence?: { grade?: string } }).confidence?.grade;
    return g ?? null;
  }
  return null;
}

function formatLastMod(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

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

/**
 * B28 Module A — standalone Models & Metrics workbench.
 * Author + Run only; no Study place/publish.
 * Window control is models-only (metric window is definitional).
 */
export function ModelsMetricsWorkbench({ clientUserId, clientName }: Props) {
  const base = `/api/operator/treasury/clients/${clientUserId}`;
  const recordHref = `/operator/treasury/clients/${clientUserId}`;

  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricWizardOpen, setMetricWizardOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);

  const [selected, setSelected] = useState<RunTarget | null>(null);
  const [windowRange, setWindowRange] = useState<TreasuryDateRange>(
    defaultTrailing12
  );
  const [runBusy, setRunBusy] = useState(false);
  const [metricResult, setMetricResult] = useState<
    MetricRow["computed_value"] | null
  >(null);
  const [modelResult, setModelResult] = useState<ModelRunResult | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    const res = await fetch(`${base}/metrics`);
    if (!res.ok) return;
    const json = (await res.json()) as { metrics?: MetricRow[] };
    setMetrics(
      (json.metrics ?? []).filter((m) => m.client_user_id === clientUserId)
    );
  }, [base, clientUserId]);

  const loadModels = useCallback(async () => {
    const res = await fetch(`${base}/studies`);
    if (!res.ok) return;
    const json = (await res.json()) as { studies?: ModelRow[] };
    setModels((json.studies ?? []).filter((s) => s.type !== "spend_plan"));
  }, [base]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadMetrics(), loadModels()]);
    } finally {
      setLoading(false);
    }
  }, [loadMetrics, loadModels]);

  useEffect(() => {
    void reload();
  }, [reload, modelsRefreshKey]);

  const selectedModel = useMemo(
    () =>
      selected?.kind === "model"
        ? (models.find((m) => m.id === selected.id) ?? null)
        : null,
    [selected, models]
  );

  const runMetric = useCallback(
    async (m: MetricRow) => {
      setSelected({ kind: "metric", id: m.id, name: m.name });
      setRunBusy(true);
      setError(null);
      setModelResult(null);
      try {
        const res = await fetch(`${base}/metrics/${m.id}/compute`, {
          method: "POST",
        });
        const j = (await res.json()) as MetricRow["computed_value"] & {
          error?: string;
          computed_at?: string;
        };
        if (!res.ok) throw new Error(j.error ?? "Metric compute failed");
        setMetricResult(j);
        setRunNote(
          j.computed_at
            ? `Computed ${j.computed_at.slice(0, 19).replace("T", " ")} (persisted)`
            : "Computed (persisted)"
        );
        await loadMetrics();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Run failed");
      } finally {
        setRunBusy(false);
      }
    },
    [base, loadMetrics]
  );

  const runModel = useCallback(
    async (m: ModelRow, range: TreasuryDateRange) => {
      setSelected({ kind: "model", id: m.id, name: m.name });
      setRunBusy(true);
      setError(null);
      setMetricResult(null);
      try {
        const asOf = range.to ?? todayIso();
        const res = await fetch(`${base}/studies/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: m.type,
            name: m.name,
            params: m.params ?? {},
            scenarios: m.scenarios ?? [],
            scope: m.scope ?? null,
            derived_snapshot: m.derived_snapshot ?? null,
            status: m.status ?? null,
            asOf,
          }),
        });
        const j = (await res.json()) as ModelRunResult & { error?: string };
        if (!res.ok) throw new Error(j.error ?? "Model preview failed");
        setModelResult(j);
        setRunNote(`Preview as of ${asOf} (not persisted)`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Run failed");
      } finally {
        setRunBusy(false);
      }
    },
    [base]
  );

  async function runSelected() {
    if (!selected) return;
    if (selected.kind === "metric") {
      const m = metrics.find((x) => x.id === selected.id);
      if (m) await runMetric(m);
      return;
    }
    const m = models.find((x) => x.id === selected.id);
    if (m) await runModel(m, windowRange);
  }

  const conf =
    modelResult?.confidence ?? modelResult?.snapshot?.confidence ?? null;
  const assumptions = modelResult?.snapshot?.assumptions ?? [];
  const methodNote =
    modelResult?.snapshot?.method_note ?? modelResult?.explain ?? null;

  return (
    <div className="view on" data-testid="models-metrics-workbench">
      <div className="mb-4">
        <Link href={recordHref} className="rcx-linkbtn text-sm">
          ← {clientName}
        </Link>
        <div className="hubhead" style={{ marginTop: 8 }}>
          <div>
            <div className="eyebrow">Operator</div>
            <h1 className="title">Models &amp; Metrics</h1>
            <p className="treasury-meta text-sm mt-1">
              Author and run metrics and models for this client. No Studies here.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <p className="treasury-meta cm-err mb-3" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="rcx-muted text-sm">Loading…</p>
      ) : (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr)",
          }}
        >
          <section className="panel p-3" data-testid="workbench-metrics">
            <div className="flex items-center gap-2 mb-2">
              <p className="sec-title mb-0">Metrics</p>
              <span className="rcx-muted text-xs">· {metrics.length}</span>
              <button
                type="button"
                className="chip"
                style={{ marginLeft: "auto" }}
                onClick={() => setMetricWizardOpen(true)}
              >
                + New metric
              </button>
            </div>
            <ul
              className="space-y-2"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {metrics.length === 0 ? (
                <li className="treasury-meta text-sm">No metrics yet.</li>
              ) : (
                metrics.map((m) => {
                  const kindLabel =
                    m.kind === "value"
                      ? "Value"
                      : m.kind === "comparison"
                        ? "Compare"
                        : "Series";
                  const active =
                    selected?.kind === "metric" && selected.id === m.id;
                  return (
                    <li
                      key={m.id}
                      className="rcx-sitem"
                      style={{
                        border: active
                          ? "1px solid var(--amber, #EBC06D)"
                          : "1px solid var(--line)",
                        borderRadius: 4,
                        padding: "8px 10px",
                      }}
                    >
                      <div className="sn">
                        {m.name}
                        <span className="chip" style={{ marginLeft: 6 }}>
                          {kindLabel}
                        </span>
                      </div>
                      <div className="sk rcx-muted text-xs">
                        Last modified {formatLastMod(m.updated_at)}
                      </div>
                      <div className="sb flex gap-2 mt-1">
                        <button
                          type="button"
                          className="chip"
                          onClick={() => {
                            setSelected({
                              kind: "metric",
                              id: m.id,
                              name: m.name,
                            });
                            setMetricResult(m.computed_value);
                            setModelResult(null);
                            setRunNote(
                              m.computed_at
                                ? `Last computed ${m.computed_at.slice(0, 10)} — Run to recompute`
                                : "Not computed yet — Run to compute"
                            );
                          }}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          className="chip"
                          disabled={runBusy}
                          onClick={() => void runMetric(m)}
                        >
                          Run
                        </button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          <section className="panel p-3" data-testid="workbench-models">
            <div className="flex items-center gap-2 mb-2">
              <p className="sec-title mb-0">Models</p>
              <span className="rcx-muted text-xs">· {models.length}</span>
              <button
                type="button"
                className="chip"
                style={{ marginLeft: "auto" }}
                onClick={() => setStudioOpen(true)}
              >
                + New model
              </button>
            </div>
            <ul
              className="space-y-2"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {models.length === 0 ? (
                <li className="treasury-meta text-sm">No models yet.</li>
              ) : (
                models.map((m) => {
                  const grade = gradeOf(m.derived_snapshot);
                  const kindLabel = getModelKind(m.type)?.label ?? m.type;
                  const active =
                    selected?.kind === "model" && selected.id === m.id;
                  return (
                    <li
                      key={m.id}
                      className="rcx-sitem model"
                      style={{
                        border: active
                          ? "1px solid var(--amber, #EBC06D)"
                          : "1px solid var(--line)",
                        borderRadius: 4,
                        padding: "8px 10px",
                      }}
                    >
                      <div className="sn">
                        {m.name}
                        <span className="chip" style={{ marginLeft: 6 }}>
                          {kindLabel}
                        </span>
                        {grade ? (
                          <span
                            className="conf"
                            data-grade={grade}
                            style={{ marginLeft: 6, fontSize: 11 }}
                          >
                            {GRADE_LABEL[grade] ?? grade}
                          </span>
                        ) : null}
                      </div>
                      <div className="sk rcx-muted text-xs">
                        Last modified {formatLastMod(m.updated_at)}
                      </div>
                      <div className="sb flex gap-2 mt-1">
                        <button
                          type="button"
                          className="chip"
                          onClick={() => {
                            setSelected({
                              kind: "model",
                              id: m.id,
                              name: m.name,
                            });
                            setMetricResult(null);
                            setModelResult(null);
                            setRunNote("Choose a window and Run to preview");
                          }}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          className="chip"
                          disabled={runBusy}
                          onClick={() => void runModel(m, windowRange)}
                        >
                          Run
                        </button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          <section className="panel p-3" data-testid="workbench-run">
            <p className="sec-title mb-2">Run</p>
            {!selected ? (
              <p className="treasury-meta text-sm">
                Select a metric or model, then Run.
              </p>
            ) : (
              <>
                <p className="text-sm mb-2">
                  <span className="chip">{selected.kind}</span>{" "}
                  <strong>{selected.name}</strong>
                </p>

                {selected.kind === "model" ? (
                  <div className="mb-3" data-testid="workbench-model-window">
                    <p className="treasury-meta text-xs mb-1">
                      Window (runtime input to preview)
                    </p>
                    <TreasuryDateRangePicker
                      value={windowRange}
                      onChange={setWindowRange}
                    />
                  </div>
                ) : (
                  <p
                    className="treasury-meta text-xs mb-3"
                    data-testid="workbench-metric-no-window"
                  >
                    Window is part of the metric definition — edit the metric to
                    change it. Run recomputes and persists{" "}
                    <code>computed_value</code>.
                  </p>
                )}

                <button
                  type="button"
                  className="chip"
                  disabled={runBusy}
                  onClick={() => void runSelected()}
                >
                  {runBusy ? "Running…" : "Run"}
                </button>
                {runNote ? (
                  <p className="treasury-meta text-xs mt-2">{runNote}</p>
                ) : null}

                {selected.kind === "metric" && metricResult ? (
                  <div
                    className="mt-3 space-y-2"
                    data-testid="workbench-metric-result"
                  >
                    {"value" in metricResult &&
                    typeof metricResult.value === "number" ? (
                      <p className="text-lg font-head">
                        {formatValue(metricResult.value)}
                      </p>
                    ) : null}
                    {isAnalyticsEnvelope(metricResult) ? (
                      <MetricChart
                        points={metricResult.points}
                        referenceLines={metricResult.reference_lines}
                        chartHint={
                          metricResult.chart_hint === "line" ? "line" : "column"
                        }
                        height={200}
                      />
                    ) : null}
                    {isComparisonEnvelope(metricResult) ? (
                      <MetricComparisonChart comparison={metricResult} />
                    ) : null}
                  </div>
                ) : null}

                {selected.kind === "model" && modelResult ? (
                  <div
                    className="mt-3 space-y-2"
                    data-testid="workbench-model-result"
                  >
                    {conf ? (
                      <span className="study-conf" data-grade={conf.grade}>
                        {GRADE_LABEL[conf.grade] ?? conf.grade}
                      </span>
                    ) : null}
                    {assumptions.length ? (
                      <ul className="text-sm" style={{ paddingLeft: 16 }}>
                        {assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                    {methodNote ? (
                      <p className="treasury-meta text-sm">{methodNote}</p>
                    ) : null}
                    {modelResult.snapshot.kpis?.length ? (
                      <div className="flex flex-wrap gap-3 mt-2">
                        {modelResult.snapshot.kpis.map((k, i) => (
                          <div key={i}>
                            <div className="treasury-meta text-xs">{k.label}</div>
                            <div className="font-head">
                              {typeof k.value === "number"
                                ? formatValue(k.value)
                                : k.value}
                              {k.unit && k.unit !== "usd" ? (
                                <span className="text-xs ml-1">{k.unit}</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {selectedModel ? (
                      <p className="treasury-meta text-xs mt-2">
                        Kind ·{" "}
                        {getModelKind(selectedModel.type)?.label ??
                          selectedModel.type}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {metricWizardOpen ? (
        <div
          className="rcx-modal-scrim"
          onClick={() => {
            setMetricWizardOpen(false);
            void loadMetrics();
          }}
        >
          <div
            className="rcx-modal"
            data-testid="workbench-metric-wizard"
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
                  setMetricWizardOpen(false);
                  void loadMetrics();
                }}
              >
                Done
              </button>
            </div>
            <MetricsTab clientUserId={clientUserId} />
          </div>
        </div>
      ) : null}

      <ModelStudio
        clientUserId={clientUserId}
        reviewId={null}
        reviewStatus="draft"
        open={studioOpen}
        allowPlace={false}
        onClose={() => setStudioOpen(false)}
        onSaved={() => {
          setModelsRefreshKey((k) => k + 1);
          setStudioOpen(false);
        }}
        onError={setError}
      />
    </div>
  );
}
