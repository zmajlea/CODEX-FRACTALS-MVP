"use client";

import { useEffect, useRef, useState } from "react";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import {
  LAYOUT_PRESETS,
  gridColumnSpan,
  resolveLayout,
  type ReviewBlockLayout,
} from "@/lib/treasury/review-block-layout";
import {
  emptyStudyPageComposite,
  newCompositeId,
  type StudyCompositeExhibit,
  type StudyCompositeNote,
  type StudyPageComposite,
} from "@/lib/treasury/study-page-composite";

export type StudyCanvasKpi = {
  id: string;
  label: string;
  value: string;
  unit: string;
  layout: ReviewBlockLayout;
};

export type StudyCanvasState = {
  kpis: StudyCanvasKpi[];
  exhibits: StudyCompositeExhibit[];
  notes: StudyCompositeNote[];
};

type MetricRow = {
  id: string;
  name: string;
  kind: string;
};

type Props = {
  clientUserId: string;
  name: string;
  typeLabel: string;
  openingBalance: string;
  onNameChange: (v: string) => void;
  onTypeLabelChange: (v: string) => void;
  onOpeningBalanceChange: (v: string) => void;
  value: StudyCanvasState;
  onChange: (next: StudyCanvasState) => void;
  disabled?: boolean;
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** B17 M2 — study page canvas (shared layout primitives with Issue M1). */
export function StudyAuthorCanvas({
  clientUserId,
  name,
  typeLabel,
  openingBalance,
  onNameChange,
  onTypeLabelChange,
  onOpeningBalanceChange,
  value,
  onChange,
  disabled,
}: Props) {
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [bp, setBp] = useState<"desktop" | "tablet" | "phone">("desktop");
  const [adding, setAdding] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const base = `/api/operator/treasury/clients/${clientUserId}`;

  useEffect(() => {
    void fetch(`${base}/metrics`)
      .then((r) => r.json())
      .then((j: { metrics?: MetricRow[] }) => setMetrics(j.metrics ?? []))
      .catch(() => setMetrics([]));
  }, [base]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      if (w < 520) setBp("phone");
      else if (w < 860) setBp("tablet");
      else setBp("desktop");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function setKpiLayout(id: string, layout: ReviewBlockLayout) {
    onChange({
      ...value,
      kpis: value.kpis.map((k) => (k.id === id ? { ...k, layout } : k)),
    });
  }

  function setExhibitLayout(id: string, layout: ReviewBlockLayout) {
    onChange({
      ...value,
      exhibits: value.exhibits.map((e) =>
        e.id === id ? { ...e, layout } : e
      ),
    });
  }

  function setNoteLayout(id: string, layout: ReviewBlockLayout) {
    onChange({
      ...value,
      notes: value.notes.map((n) => (n.id === id ? { ...n, layout } : n)),
    });
  }

  function addBlankKpi() {
    onChange({
      ...value,
      kpis: [
        ...value.kpis,
        {
          id: newCompositeId("kpi"),
          label: "",
          value: "",
          unit: "",
          layout: { w: 3, h: 1 },
        },
      ],
    });
  }

  function addNote() {
    onChange({
      ...value,
      notes: [
        ...value.notes,
        {
          id: newCompositeId("note"),
          body: "",
          layout: { w: 4, h: 1 },
        },
      ],
    });
  }

  async function placeMetric(metricId: string, as: "figure" | "exhibit") {
    setAdding(metricId);
    try {
      const res = await fetch(`${base}/metrics/${metricId}/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        error?: string;
        kind?: string;
        value?: number;
        points?: Array<{
          bucket_start: string;
          bucket_label: string;
          value: number;
          partial?: boolean;
        }>;
        series?: {
          points?: Array<{
            bucket_start: string;
            bucket_label: string;
            value: number;
            partial?: boolean;
          }>;
          reference_lines?: Array<{ label: string; value: number; kind?: string }>;
          chart_hint?: string;
          summary?: { value?: number };
        };
        reference_lines?: Array<{ label: string; value: number; kind?: string }>;
        chart_hint?: string;
        summary?: { value?: number };
        name?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Compute failed");
      const metric = metrics.find((m) => m.id === metricId);
      const title = metric?.name ?? "Metric";
      const points = json.series?.points ?? json.points ?? [];
      const refs = json.series?.reference_lines ?? json.reference_lines ?? [];
      const chartHint = json.series?.chart_hint ?? json.chart_hint;
      const summary =
        typeof json.value === "number"
          ? json.value
          : typeof json.series?.summary?.value === "number"
            ? json.series.summary.value
            : typeof json.summary?.value === "number"
              ? json.summary.value
              : null;

      if (as === "figure" || !points.length) {
        onChange({
          ...value,
          kpis: [
            ...value.kpis,
            {
              id: newCompositeId("kpi"),
              label: title,
              value: String(summary ?? 0),
              unit: "usd",
              layout: { w: 3, h: 1 },
            },
          ],
        });
        return;
      }

      const exhibit: StudyCompositeExhibit = {
        id: newCompositeId("exhibit"),
        title,
        chart_hint: chartHint === "line" ? "line" : "column",
        points: points.map((p) => ({
          month: (p.bucket_label || p.bucket_start || "").slice(0, 7),
          ending: p.value,
          projected: p.partial ? true : undefined,
        })),
        reference_lines: refs.map((r) => ({
          label: r.label,
          value: r.value,
          breach: r.kind === "threshold" ? true : undefined,
        })),
        layout: { w: 12, h: 2 },
      };
      onChange({
        ...value,
        exhibits: [...value.exhibits, exhibit],
      });
    } catch {
      /* parent surfaces errors via save path; silent add failure */
    } finally {
      setAdding(null);
    }
  }

  const SizePresets = ({
    layout,
    onPick,
  }: {
    layout: ReviewBlockLayout;
    onPick: (l: ReviewBlockLayout) => void;
  }) => (
    <span className="rcx-sz" role="group" aria-label="Block size">
      {LAYOUT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`rcx-tool${layout.w === p.w ? " primary" : ""}`}
          disabled={disabled}
          onClick={() => onPick({ w: p.w, h: p.h })}
        >
          {p.label}
        </button>
      ))}
    </span>
  );

  return (
    <div className="study-author" data-testid="study-author-canvas">
      <div className="study-author-head">
        <label className="rcx-muted" style={{ display: "block", fontSize: 11 }}>
          Name
          <input
            className="rcx-confirm-input"
            style={{ display: "block", width: "100%", marginTop: 4 }}
            value={name}
            disabled={disabled}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <label
          className="rcx-muted"
          style={{ display: "block", fontSize: 11, marginTop: 8 }}
        >
          Type label
          <input
            className="rcx-confirm-input"
            style={{ display: "block", width: "100%", marginTop: 4 }}
            value={typeLabel}
            disabled={disabled}
            onChange={(e) => onTypeLabelChange(e.target.value)}
            placeholder="Working Capital…"
          />
        </label>
        <label
          className="rcx-muted"
          style={{ display: "block", fontSize: 11, marginTop: 8 }}
        >
          Opening balance (optional)
          <input
            className="rcx-confirm-input"
            style={{ display: "block", width: "100%", marginTop: 4 }}
            value={openingBalance}
            disabled={disabled}
            onChange={(e) => onOpeningBalanceChange(e.target.value)}
          />
        </label>
      </div>

      <div className="study-author-stage" ref={canvasRef} data-bp={bp}>
        <div className="rcx-canvas">
          <div className="rcx-grid">
            {value.kpis.map((k) => {
              const layout = resolveLayout(k.layout);
              const span = gridColumnSpan(layout, bp);
              return (
                <article
                  key={k.id}
                  className="rcx-block"
                  data-role="figure"
                  style={{ gridColumn: `span ${span}` }}
                >
                  <div className="rcx-bchrome">
                    <span className="rcx-chip rcx-role">kpi</span>
                    <SizePresets
                      layout={layout}
                      onPick={(l) => setKpiLayout(k.id, l)}
                    />
                    <button
                      type="button"
                      className="rcx-tool danger"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...value,
                          kpis: value.kpis.filter((x) => x.id !== k.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    placeholder="Label"
                    value={k.label}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        kpis: value.kpis.map((x) =>
                          x.id === k.id ? { ...x, label: e.target.value } : x
                        ),
                      })
                    }
                    style={{ fontSize: 11, width: "100%", marginBottom: 4 }}
                  />
                  <div className="rcx-figval">
                    {Number.isFinite(Number(k.value))
                      ? money(Number(k.value))
                      : k.value || "—"}
                  </div>
                  <input
                    placeholder="Value"
                    value={k.value}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        kpis: value.kpis.map((x) =>
                          x.id === k.id ? { ...x, value: e.target.value } : x
                        ),
                      })
                    }
                    style={{ fontSize: 12, width: "100%" }}
                  />
                </article>
              );
            })}

            {value.exhibits.map((e) => {
              const layout = resolveLayout(e.layout);
              const span = gridColumnSpan(layout, bp);
              const asChart = layout.w >= 6;
              const points = e.points.map((p) => ({
                bucket_start: `${p.month}-01`,
                bucket_label: p.month,
                value: p.ending,
              }));
              return (
                <article
                  key={e.id}
                  className="rcx-block"
                  data-role={asChart ? "exhibit" : "figure"}
                  style={{ gridColumn: `span ${span}` }}
                >
                  <div className="rcx-bchrome">
                    <span className="rcx-chip rcx-role">exhibit</span>
                    <span className="rcx-src">{e.title}</span>
                    <SizePresets
                      layout={layout}
                      onPick={(l) => setExhibitLayout(e.id, l)}
                    />
                    <button
                      type="button"
                      className="rcx-tool danger"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...value,
                          exhibits: value.exhibits.filter((x) => x.id !== e.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  {asChart && points.length ? (
                    <div className="rcx-chart">
                      <MetricChart
                        points={points}
                        referenceLines={e.reference_lines.map((r, i) => ({
                          id: `r-${i}`,
                          label: r.label,
                          value: r.value,
                          kind: r.breach ? "threshold" : "ref",
                        }))}
                        chartHint={e.chart_hint === "line" ? "line" : "column"}
                        height={180}
                      />
                    </div>
                  ) : (
                    <div className="rcx-figval">
                      {points.length
                        ? money(points[points.length - 1]!.value)
                        : "—"}
                      <span className="rcx-fighint"> · summary</span>
                    </div>
                  )}
                </article>
              );
            })}

            {value.notes.map((n) => {
              const layout = resolveLayout(n.layout);
              const span = gridColumnSpan(layout, bp);
              return (
                <article
                  key={n.id}
                  className="rcx-block"
                  data-role="note"
                  style={{ gridColumn: `span ${span}` }}
                >
                  <div className="rcx-bchrome">
                    <span className="rcx-chip rcx-role">note</span>
                    <SizePresets
                      layout={layout}
                      onPick={(l) => setNoteLayout(n.id, l)}
                    />
                    <button
                      type="button"
                      className="rcx-tool danger"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...value,
                          notes: value.notes.filter((x) => x.id !== n.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    className="rcx-cap"
                    rows={3}
                    value={n.body}
                    disabled={disabled}
                    placeholder="Inline note…"
                    onChange={(e) =>
                      onChange({
                        ...value,
                        notes: value.notes.map((x) =>
                          x.id === n.id ? { ...x, body: e.target.value } : x
                        ),
                      })
                    }
                  />
                </article>
              );
            })}
          </div>
        </div>

        <div className="study-shelf">
          <div className="rcx-kick">Shelf</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              className="rcx-tool"
              disabled={disabled}
              onClick={addBlankKpi}
            >
              + KPI
            </button>
            <button
              type="button"
              className="rcx-tool"
              disabled={disabled}
              onClick={addNote}
            >
              + Note
            </button>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 220, overflow: "auto" }}>
            {metrics.map((m) => (
              <li
                key={m.id}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{m.name}</span>
                <button
                  type="button"
                  className="rcx-tool"
                  disabled={disabled || adding === m.id}
                  onClick={() => void placeMetric(m.id, "figure")}
                >
                  Figure
                </button>
                <button
                  type="button"
                  className="rcx-tool"
                  disabled={disabled || adding === m.id}
                  onClick={() => void placeMetric(m.id, "exhibit")}
                >
                  Exhibit
                </button>
              </li>
            ))}
            {!metrics.length ? (
              <li className="rcx-muted" style={{ fontSize: 11 }}>
                No metrics yet — add KPIs/notes manually.
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Build results + composite for POST /studies (round-trip persistence). */
export function buildStudySavePayload(input: {
  name: string;
  openingBalance: string;
  canvas: StudyCanvasState;
}): { results: Record<string, unknown>; composite: StudyPageComposite } {
  const kpis = input.canvas.kpis
    .map((k) => ({
      id: k.id,
      label: k.label.trim(),
      value: Number.isFinite(Number(k.value)) ? Number(k.value) : k.value.trim(),
      unit: k.unit.trim() || undefined,
      layout: resolveLayout(k.layout),
    }))
    .filter((k) => k.label);

  const exhibits = input.canvas.exhibits.map((e) => ({
    ...e,
    layout: resolveLayout(e.layout),
  }));

  const notes = input.canvas.notes
    .map((n) => ({
      ...n,
      body: n.body.trim(),
      layout: resolveLayout(n.layout),
    }))
    .filter((n) => n.body);

  const scenarios = exhibits.map((e, i) => ({
    id: e.id,
    name: e.title || `Scenario ${i + 1}`,
    timeline: e.points.map((p, pi) => {
      const prevEnding = pi > 0 ? e.points[pi - 1]!.ending : p.ending;
      const beginning = pi === 0 ? p.ending : prevEnding;
      const net = p.ending - beginning;
      return {
        month: p.month.length === 7 ? `${p.month}-01` : p.month,
        beginning,
        net,
        ending: p.ending,
      };
    }),
    runway_months: null as number | null,
    breach_month: null as string | null,
  }));

  const results: Record<string, unknown> = {
    schema_version: "summit.results/v1",
    export_id: `manual-${Date.now()}`,
    as_of: new Date().toISOString().slice(0, 10),
    headline: input.name.trim(),
    kpis: kpis.map(({ label, value, unit }) => ({ label, value, unit })),
    scenarios,
    narrative: notes.map((n) => ({ heading: "note", body: n.body })),
    recommendations: [],
    actuals_check: [],
  };
  if (input.openingBalance.trim() && Number.isFinite(Number(input.openingBalance))) {
    results.opening_balance = Number(input.openingBalance);
  }

  const composite: StudyPageComposite = {
    exhibits,
    notes,
    kpiLayouts: kpis.map((k) => ({ id: k.id, layout: k.layout })),
  };

  return { results, composite };
}

export function canvasStateFromComposite(
  composite: StudyPageComposite | null | undefined,
  resultsKpis: Array<{ label: string; value: number | string; unit?: string }>
): StudyCanvasState {
  if (!composite) {
    return {
      kpis: resultsKpis.map((k, i) => ({
        id: `kpi-${i}`,
        label: k.label,
        value: String(k.value),
        unit: k.unit ?? "",
        layout: { w: 3, h: 1 },
      })),
      exhibits: [],
      notes: [],
    };
  }
  return {
    kpis: resultsKpis.map((k, i) => {
      const lay = composite.kpiLayouts[i];
      return {
        id: lay?.id ?? `kpi-${i}`,
        label: k.label,
        value: String(k.value),
        unit: k.unit ?? "",
        layout: resolveLayout(lay?.layout ?? { w: 3, h: 1 }),
      };
    }),
    exhibits: composite.exhibits ?? [],
    notes: composite.notes ?? [],
  };
}

export { emptyStudyPageComposite };
