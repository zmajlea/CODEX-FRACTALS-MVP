"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MetricChart,
  type MetricChartPoint,
  type MetricChartRefLine,
} from "@/components/operator/treasury/analytics/MetricChart";
import { MetricComparisonChart } from "@/components/operator/treasury/analytics/MetricComparisonChart";
import type { MetricComparison } from "@/lib/treasury/metrics-eval";

export type SentenceVerb = "sum" | "avg" | "count" | "min" | "max";
export type SentenceSubdivision =
  | "total"
  | "day"
  | "week"
  | "biweek"
  | "month"
  | "quarter"
  | "year";
export type SentenceWindowKind =
  | "trailing"
  | "calendar_year"
  | "ytd"
  | "range"
  | "all";
export type SentenceCompare =
  | "none"
  | "year"
  | "previous"
  | "range"
  | "category";

export type SentenceDraft = {
  verb: SentenceVerb;
  sourceType: "bucket" | "category" | "account" | "metric";
  sourceKey: string;
  sourceRef: string;
  direction: "in" | "out" | "any";
  subdivision: SentenceSubdivision;
  windowKind: SentenceWindowKind;
  windowMonths: number;
  /** YYYY-MM for UI; converted to YYYY-MM-DD in definition */
  windowStartMonth: string;
  windowEndMonth: string;
  compare: SentenceCompare;
  compareLastNYears: number;
  compareKeys: string[];
  compareRefStartMonth: string;
  compareRefEndMonth: string;
  refMode: "none" | "avg" | "threshold";
  thresholdValue: number;
  thresholdBreach: boolean;
  chartHint: "column" | "line";
};

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

type Props = {
  draft: SentenceDraft;
  onChange: (next: SentenceDraft) => void;
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  scopeGeneral: boolean;
  onScopeGeneralChange: (v: boolean) => void;
  showScope: boolean;
  labels: string[];
  metricNames: string[];
  definition: unknown;
  previewSeries: MetricSeriesEnvelope | null;
  previewComparison: MetricComparison | null;
  previewLabel: string | null;
  previewMs: number | null;
  fieldErrors: string | null;
  busy: string | null;
  mode: "guided" | "advanced";
  onModeChange: (mode: "guided" | "advanced") => void;
  jsonText: string;
  onJsonTextChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  editing: boolean;
};

const WZ_STEPS = [
  ["what", "What do you want to see?"],
  ["cadence", "How finely?"],
  ["window", "Over what window?"],
  ["compare", "Compared with what?"],
  ["finish", "Finishing touches"],
] as const;

const VERB_OPTIONS: { value: SentenceVerb; label: string }[] = [
  { value: "sum", label: "sum" },
  { value: "avg", label: "average" },
  { value: "count", label: "count" },
  { value: "max", label: "highest" },
  { value: "min", label: "lowest" },
];

const DIR_OPTIONS: { value: "in" | "out" | "any"; label: string }[] = [
  { value: "out", label: "going out" },
  { value: "in", label: "coming in" },
  { value: "any", label: "either way" },
];

function monthStart(ym: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ym)) return ym;
  return `${ym}-01`;
}

function monthEnd(ym: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return `${ym}-28`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}

function toYm(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback;
  return iso.slice(0, 7);
}

export function emptySentenceDraft(): SentenceDraft {
  return {
    verb: "sum",
    sourceType: "category",
    sourceKey: "",
    sourceRef: "",
    direction: "out",
    subdivision: "week",
    windowKind: "trailing",
    windowMonths: 3,
    windowStartMonth: "2026-01",
    windowEndMonth: "2026-03",
    compare: "none",
    compareLastNYears: 2,
    compareKeys: [],
    compareRefStartMonth: "2022-03",
    compareRefEndMonth: "2022-03",
    refMode: "none",
    thresholdValue: 6000,
    thresholdBreach: true,
    chartHint: "column",
  };
}

export function definitionFromSentence(d: SentenceDraft): Record<string, unknown> {
  const source =
    d.sourceType === "metric"
      ? { type: "metric" as const, ref: d.sourceRef, direction: d.direction }
      : d.sourceType === "account"
        ? { type: "account" as const, direction: d.direction }
        : {
            type: d.sourceType,
            key: d.sourceKey,
            direction: d.direction,
          };

  const window =
    d.windowKind === "trailing"
      ? { kind: "trailing" as const, months: d.windowMonths }
      : d.windowKind === "range"
        ? {
            kind: "range" as const,
            start: monthStart(d.windowStartMonth),
            end: monthEnd(d.windowEndMonth),
          }
        : { kind: d.windowKind };

  if (d.subdivision === "total") {
    return {
      of: "monthly_totals",
      source,
      op: d.verb,
      window,
    };
  }

  const bucket_op = d.verb;
  const chart_hint =
    d.compare === "none"
      ? d.chartHint
      : d.chartHint === "line"
        ? "multi_line"
        : "grouped_column";

  let reference_lines: Array<Record<string, unknown>> | undefined;
  if (d.refMode === "avg") {
    reference_lines = [
      { id: "r1", label: "Average", kind: "avg", stat: "avg", breach: "none" },
    ];
  } else if (d.refMode === "threshold") {
    reference_lines = [
      {
        id: "r1",
        label: "Ceiling",
        kind: "threshold",
        value: d.thresholdValue,
        breach: d.thresholdBreach ? "flag" : "none",
      },
    ];
  }

  if (d.compare !== "none") {
    const compare =
      d.compare === "year"
        ? { by: "year" as const, last_n_years: d.compareLastNYears }
        : d.compare === "previous"
          ? { by: "previous" as const }
          : d.compare === "range"
            ? {
                by: "range" as const,
                ref_start: monthStart(d.compareRefStartMonth),
                ref_end: monthEnd(d.compareRefEndMonth),
              }
            : { by: "category" as const, keys: d.compareKeys };

    return {
      of: "series_compare",
      source,
      window,
      subdivision: d.subdivision,
      bucket_op,
      chart_hint,
      ...(reference_lines ? { reference_lines } : {}),
      compare,
    };
  }

  return {
    of: "series_totals",
    source,
    window,
    subdivision: d.subdivision,
    bucket_op,
    op: d.verb === "count" ? "sum" : d.verb,
    chart_hint,
    ...(reference_lines ? { reference_lines } : {}),
  };
}

export function sentenceFromDefinition(
  def: Record<string, unknown> | null | undefined
): SentenceDraft {
  const base = emptySentenceDraft();
  if (!def || typeof def !== "object") return base;

  const source = (def.source ?? {}) as {
    type?: SentenceDraft["sourceType"];
    key?: string;
    ref?: string;
    direction?: SentenceDraft["direction"];
  };
  const window = (def.window ?? {}) as {
    kind?: SentenceWindowKind;
    months?: number;
    start?: string;
    end?: string;
  };
  const compare = def.compare as
    | {
        by?: string;
        last_n_years?: number;
        keys?: string[];
        ref_start?: string;
        ref_end?: string;
      }
    | undefined;

  const of = def.of as string | undefined;
  const subdivision =
    of === "monthly_totals" || !def.subdivision
      ? ("total" as const)
      : (def.subdivision as SentenceSubdivision);

  const verbRaw =
    subdivision === "total"
      ? (def.op as string | undefined)
      : (def.bucket_op as string | undefined) ?? (def.op as string | undefined);
  const verb = (
    ["sum", "avg", "count", "min", "max"].includes(verbRaw ?? "")
      ? verbRaw
      : "sum"
  ) as SentenceVerb;

  let compareMode: SentenceCompare = "none";
  if (of === "series_compare" && compare?.by) {
    if (
      compare.by === "year" ||
      compare.by === "previous" ||
      compare.by === "range" ||
      compare.by === "category"
    ) {
      compareMode = compare.by;
    }
  }

  const refs = def.reference_lines as
    | Array<{ kind?: string; value?: number; breach?: string }>
    | undefined;
  let refMode: SentenceDraft["refMode"] = "none";
  let thresholdValue = 6000;
  let thresholdBreach = true;
  if (refs?.length) {
    const r = refs[0];
    if (r.kind === "avg") refMode = "avg";
    else if (r.kind === "threshold") {
      refMode = "threshold";
      thresholdValue = typeof r.value === "number" ? r.value : 6000;
      thresholdBreach = r.breach === "flag";
    }
  }

  const chartHintRaw = def.chart_hint as string | undefined;
  const chartHint: "column" | "line" =
    chartHintRaw === "line" || chartHintRaw === "multi_line" ? "line" : "column";

  return {
    ...base,
    verb,
    sourceType: source.type ?? "category",
    sourceKey: source.key ?? "",
    sourceRef: source.ref ?? "",
    direction: source.direction ?? "any",
    subdivision,
    windowKind: window.kind ?? "trailing",
    windowMonths: window.months ?? 3,
    windowStartMonth: toYm(window.start, base.windowStartMonth),
    windowEndMonth: toYm(window.end, base.windowEndMonth),
    compare: compareMode,
    compareLastNYears: compare?.last_n_years ?? 2,
    compareKeys: compare?.keys ?? [],
    compareRefStartMonth: toYm(compare?.ref_start, base.compareRefStartMonth),
    compareRefEndMonth: toYm(compare?.ref_end, base.compareRefEndMonth),
    refMode,
    thresholdValue,
    thresholdBreach,
    chartHint,
  };
}

export function autoNameFromSentence(d: SentenceDraft): string {
  const subject =
    d.sourceType === "metric"
      ? d.sourceRef || "metric"
      : d.sourceType === "account"
        ? "account"
        : d.sourceKey || d.sourceType;
  const cadence =
    d.subdivision === "total" ? d.verb : `by ${d.subdivision}`;
  const win =
    d.windowKind === "trailing"
      ? `last ${d.windowMonths}m`
      : d.windowKind === "range"
        ? "fixed"
        : d.windowKind;
  const cmp =
    d.compare === "year"
      ? " vs last year"
      : d.compare === "previous"
        ? " vs prior period"
        : d.compare === "range"
          ? ` vs ${d.compareRefStartMonth}`
          : d.compare === "category"
            ? " by category"
            : "";
  return `${subject} · ${cadence} · ${win}${cmp}`;
}

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function Seg({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="msw-seg" role="group" style={{ opacity: disabled ? 0.45 : 1 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-selected={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Spec B18 Part B — live sentence metric composer.
 * Each slot writes one grammar field; parent debounces preview_metric.
 */
export function MetricSentenceWizard({
  draft,
  onChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  scopeGeneral,
  onScopeGeneralChange,
  showScope,
  labels,
  metricNames,
  definition,
  previewSeries,
  previewComparison,
  previewLabel,
  previewMs,
  fieldErrors,
  busy,
  mode,
  onModeChange,
  jsonText,
  onJsonTextChange,
  onSave,
  onCancel,
  editing,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [bp, setBp] = useState<"desktop" | "tablet" | "phone">("desktop");
  const [step, setStep] = useState<(typeof WZ_STEPS)[number][0]>("what");
  const [nameTouched, setNameTouched] = useState(editing);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 900;
      if (w < 520) setBp("phone");
      else if (w < 860) setBp("tablet");
      else setBp("desktop");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!nameTouched) {
      onNameChange(autoNameFromSentence(draft));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-autoname when draft slots change
  }, [draft, nameTouched]);

  const patch = (partial: Partial<SentenceDraft>) => {
    onChange({ ...draft, ...partial });
  };

  const kind =
    draft.subdivision === "total"
      ? "value"
      : draft.compare !== "none"
        ? "comparison"
        : "analytics";

  const compareDisabled = draft.subdivision === "total";
  const stepIndex = WZ_STEPS.findIndex((s) => s[0] === step);
  const isLastStep = stepIndex === WZ_STEPS.length - 1;

  const defJson = useMemo(
    () => JSON.stringify(definition, null, 2),
    [definition]
  );

  const scalarPreview =
    previewComparison?.summary?.value ??
    previewSeries?.summary?.value ??
    previewSeries?.value ??
    null;

  function moveStep(delta: number) {
    let i = stepIndex + delta;
    if (WZ_STEPS[i]?.[0] === "compare" && compareDisabled) {
      i += delta;
    }
    i = Math.max(0, Math.min(WZ_STEPS.length - 1, i));
    setStep(WZ_STEPS[i][0]);
  }

  const sentenceBlock = (
    <div className="msw-sentence" data-step="what">
      <span className="msw-soft">Show me the </span>
      <span className="msw-w">
        <select
          aria-label="Operation"
          value={draft.verb}
          onChange={(e) => patch({ verb: e.target.value as SentenceVerb })}
        >
          {VERB_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      <span className="msw-soft"> of </span>
      {draft.sourceType === "metric" ? (
        <span className="msw-w">
          <select
            aria-label="Metric"
            value={draft.sourceRef}
            onChange={(e) => patch({ sourceRef: e.target.value })}
          >
            <option value="">Select metric…</option>
            {metricNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      ) : draft.sourceType === "account" ? (
        <span className="msw-w">
          <select
            aria-label="Source"
            value="account"
            onChange={() => undefined}
          >
            <option value="account">account</option>
          </select>
        </span>
      ) : (
        <span className="msw-w">
          <input
            list="msw-label-options"
            aria-label="Category or bucket"
            placeholder="Checks"
            value={draft.sourceKey}
            onChange={(e) => patch({ sourceKey: e.target.value })}
          />
          <datalist id="msw-label-options">
            {labels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </span>
      )}
      <span className="msw-w">
        <select
          aria-label="Direction"
          value={draft.direction}
          onChange={(e) =>
            patch({ direction: e.target.value as SentenceDraft["direction"] })
          }
        >
          {DIR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {draft.subdivision !== "total" ? (
        <>
          <span className="msw-soft">, by </span>
          <span className="msw-w">
            <select
              aria-label="Subdivision"
              value={draft.subdivision}
              onChange={(e) =>
                patch({
                  subdivision: e.target.value as SentenceSubdivision,
                })
              }
            >
              <option value="day">day</option>
              <option value="week">week</option>
              <option value="biweek">biweek</option>
              <option value="month">month</option>
              <option value="quarter">quarter</option>
              <option value="year">year</option>
            </select>
          </span>
        </>
      ) : null}
      <span className="msw-soft">, over </span>
      <span className="msw-w">
        <select
          aria-label="Window"
          value={
            draft.windowKind === "trailing"
              ? `trailing:${draft.windowMonths}`
              : draft.windowKind
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("trailing:")) {
              patch({
                windowKind: "trailing",
                windowMonths: Number(v.slice("trailing:".length)) || 3,
              });
            } else {
              patch({ windowKind: v as SentenceWindowKind });
            }
          }}
        >
          <option value="trailing:1">the last 1 month</option>
          <option value="trailing:2">the last 2 months</option>
          <option value="trailing:3">the last 3 months</option>
          <option value="trailing:6">the last 6 months</option>
          <option value="trailing:12">the last 12 months</option>
          <option value="trailing:24">the last 24 months</option>
          <option value="ytd">year to date</option>
          <option value="calendar_year">this calendar year</option>
          <option value="range">a fixed range</option>
          <option value="all">everything</option>
        </select>
      </span>
      {draft.subdivision !== "total" ? (
        <>
          <span className="msw-soft">, compared with </span>
          <span className="msw-w">
            <select
              aria-label="Compare"
              value={draft.compare}
              onChange={(e) =>
                patch({ compare: e.target.value as SentenceCompare })
              }
            >
              <option value="none">nothing</option>
              <option value="year">the same period a year ago</option>
              <option value="previous">the period before</option>
              <option value="range">a fixed reference</option>
              <option value="category">other categories</option>
            </select>
          </span>
        </>
      ) : null}
      <span className="msw-soft">.</span>
    </div>
  );

  const formFields = (
    <>
      <div className="msw-fgrp" data-step="what">
        <div className="msw-fl">
          Source type<span className="msw-sub">source.type</span>
        </div>
        <Seg
          value={draft.sourceType}
          onChange={(v) =>
            patch({ sourceType: v as SentenceDraft["sourceType"] })
          }
          options={[
            { value: "category", label: "Category" },
            { value: "bucket", label: "Bucket" },
            { value: "account", label: "Account" },
            { value: "metric", label: "Metric" },
          ]}
        />
      </div>

      <div className="msw-fgrp" data-step="cadence">
        <div className="msw-fl">
          Broken down<span className="msw-sub">subdivision</span>
        </div>
        <div>
          <Seg
            value={draft.subdivision}
            onChange={(v) => {
              const sub = v as SentenceSubdivision;
              patch({
                subdivision: sub,
                ...(sub === "total" ? { compare: "none", refMode: "none" } : {}),
              });
            }}
            options={[
              { value: "total", label: "One number" },
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "biweek", label: "Biweek" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
          />
          <p className="msw-fnote">
            {draft.subdivision === "total"
              ? "One number over the window → a value metric."
              : `Buckets of one ${draft.subdivision}. Summary value still available.`}
          </p>
        </div>
      </div>

      <div className="msw-fgrp" data-step="window">
        <div className="msw-fl">
          Over<span className="msw-sub">window</span>
        </div>
        <div>
          <Seg
            value={draft.windowKind}
            onChange={(v) => patch({ windowKind: v as SentenceWindowKind })}
            options={[
              { value: "trailing", label: "Relative to now" },
              { value: "range", label: "Fixed dates" },
              { value: "ytd", label: "Year to date" },
              { value: "calendar_year", label: "Calendar year" },
              { value: "all", label: "Everything" },
            ]}
          />
          {draft.windowKind === "trailing" ? (
            <div className="msw-fsub">
              the last{" "}
              <select
                value={draft.windowMonths}
                onChange={(e) =>
                  patch({ windowMonths: Number(e.target.value) || 3 })
                }
              >
                {[1, 2, 3, 6, 12, 24].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>{" "}
              months
            </div>
          ) : null}
          {draft.windowKind === "range" ? (
            <div className="msw-fsub">
              from{" "}
              <input
                type="month"
                value={draft.windowStartMonth}
                onChange={(e) => patch({ windowStartMonth: e.target.value })}
              />{" "}
              to{" "}
              <input
                type="month"
                value={draft.windowEndMonth}
                onChange={(e) => patch({ windowEndMonth: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="msw-fgrp" data-step="compare">
        <div className="msw-fl">
          Compare with<span className="msw-sub">compare</span>
        </div>
        <div>
          <Seg
            value={draft.compare}
            disabled={compareDisabled}
            onChange={(v) => patch({ compare: v as SentenceCompare })}
            options={[
              { value: "none", label: "Nothing" },
              { value: "year", label: "Same period a year before" },
              { value: "previous", label: "The period before" },
              { value: "range", label: "A fixed reference" },
              { value: "category", label: "By category" },
            ]}
          />
          {draft.compare === "year" && !compareDisabled ? (
            <div className="msw-fsub">
              last{" "}
              <select
                value={draft.compareLastNYears}
                onChange={(e) =>
                  patch({ compareLastNYears: Number(e.target.value) || 2 })
                }
              >
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>{" "}
              years
            </div>
          ) : null}
          {draft.compare === "range" && !compareDisabled ? (
            <div className="msw-fsub">
              from{" "}
              <input
                type="month"
                value={draft.compareRefStartMonth}
                onChange={(e) =>
                  patch({ compareRefStartMonth: e.target.value })
                }
              />{" "}
              to{" "}
              <input
                type="month"
                value={draft.compareRefEndMonth}
                onChange={(e) => patch({ compareRefEndMonth: e.target.value })}
              />
            </div>
          ) : null}
          {draft.compare === "category" && !compareDisabled ? (
            <div className="msw-fsub">
              <input
                className="msw-txtin"
                placeholder="Payroll, Software"
                value={draft.compareKeys.join(", ")}
                onChange={(e) =>
                  patch({
                    compareKeys: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          ) : null}
          <p className="msw-fnote">
            {compareDisabled
              ? "Comparison needs a subdivision — pick a cadence first."
              : draft.compare === "year"
                ? 'compare: { by: "year", last_n_years } — aligned by ISO week / month / quarter.'
                : draft.compare === "previous"
                  ? "Same-length window immediately before the current one."
                  : draft.compare === "range"
                    ? "Fixed reference span, index-aligned bucket by bucket."
                    : draft.compare === "category"
                      ? "Side-by-side category series."
                      : ""}
          </p>
        </div>
      </div>

      <div className="msw-fgrp" data-step="finish">
        <div className="msw-fl">
          Reference line<span className="msw-sub">reference_lines</span>
        </div>
        <div>
          <Seg
            value={draft.refMode}
            disabled={compareDisabled}
            onChange={(v) =>
              patch({ refMode: v as SentenceDraft["refMode"] })
            }
            options={[
              { value: "none", label: "None" },
              { value: "avg", label: "Average" },
              { value: "threshold", label: "Ceiling" },
            ]}
          />
          {draft.refMode === "threshold" && !compareDisabled ? (
            <div className="msw-fsub">
              ${" "}
              <input
                style={{ width: 90 }}
                inputMode="numeric"
                value={draft.thresholdValue}
                onChange={(e) =>
                  patch({
                    thresholdValue: Number(
                      e.target.value.replace(/[^0-9.]/g, "")
                    ) || 0,
                  })
                }
              />{" "}
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={draft.thresholdBreach}
                  onChange={(e) =>
                    patch({ thresholdBreach: e.target.checked })
                  }
                />
                flag periods above it
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <div className="msw-fgrp" data-step="finish">
        <div className="msw-fl">
          Draw as<span className="msw-sub">chart_hint</span>
        </div>
        <Seg
          value={draft.chartHint}
          disabled={compareDisabled}
          onChange={(v) => patch({ chartHint: v as "column" | "line" })}
          options={[
            { value: "column", label: "Columns" },
            { value: "line", label: "Line" },
          ]}
        />
      </div>

      <div className="msw-fgrp" data-step="finish">
        <div className="msw-fl">
          Name<span className="msw-sub">auto until you edit</span>
        </div>
        <input
          className="msw-txtin"
          aria-label="Metric name"
          value={name}
          onChange={(e) => {
            setNameTouched(true);
            onNameChange(e.target.value);
          }}
        />
      </div>

      <div className="msw-fgrp" data-step="finish">
        <div className="msw-fl">Description</div>
        <input
          className="msw-txtin"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Optional"
        />
      </div>

      {showScope ? (
        <div className="msw-fgrp" data-step="finish">
          <div className="msw-fl">Scope</div>
          <label className="msw-fsub" style={{ marginTop: 0 }}>
            <input
              type="checkbox"
              checked={scopeGeneral}
              onChange={(e) => onScopeGeneralChange(e.target.checked)}
            />
            General (tenant-wide)
          </label>
        </div>
      ) : null}

      <details className="msw-def msw-wzm-def">
        <summary>
          Definition · metric grammar{" "}
          <span className="rcx-chip">
            {fieldErrors ? "schema error" : "in grammar"}
          </span>
        </summary>
        <pre>{defJson}</pre>
      </details>
    </>
  );

  const previewPanel = (
    <div className="msw-prev">
      <div className="msw-prev-card">
        <div className="msw-ph">
          <h3>{name || "—"}</h3>
          <span className="rcx-chip">{kind}</span>
        </div>
        <div className="msw-prev-fig">
          <div>
            <div className="msw-tile-l">
              {draft.subdivision === "total"
                ? `${draft.verb} of monthly totals`
                : previewLabel ?? `${draft.verb} · ${draft.subdivision}`}
            </div>
            <div className="msw-tile-n">{formatValue(scalarPreview)}</div>
          </div>
        </div>
        {draft.subdivision !== "total" ? (
          <div className="msw-prev-chart">
            {previewComparison ? (
              <MetricComparisonChart comparison={previewComparison} height={180} />
            ) : previewSeries?.points ? (
              <MetricChart
                points={previewSeries.points}
                referenceLines={previewSeries.reference_lines}
                chartHint={previewSeries.chart_hint ?? "column"}
                height={180}
              />
            ) : busy === "preview" ? (
              <p className="rcx-muted" style={{ fontSize: 12 }}>
                Evaluating…
              </p>
            ) : (
              <p className="rcx-muted" style={{ fontSize: 12 }}>
                {fieldErrors ? "Fix the definition to preview." : "Live preview"}
              </p>
            )}
          </div>
        ) : null}
        {fieldErrors ? (
          <p className="msw-err" role="alert">
            {fieldErrors}
          </p>
        ) : null}
      </div>
      <details className="msw-def" open={bp === "desktop"}>
        <summary>
          Definition · metric grammar{" "}
          <span
            className="rcx-chip"
            style={{
              color: fieldErrors ? "var(--su-warn-ink)" : "var(--su-accept, #174a7a)",
            }}
          >
            {fieldErrors ? "schema error" : "in grammar"}
          </span>
        </summary>
        <pre>{defJson}</pre>
      </details>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="msw-root panel"
      data-bp={bp}
      data-step={step}
      data-testid="metric-sentence-wizard"
      style={{ border: "1px solid var(--line)" }}
    >
      <style>{MSW_CSS}</style>
      <header className="msw-head">
        <div>
          <div className="msw-kick">Metric composer</div>
          <h2 className="msw-title">{editing ? "Edit metric" : "New metric"}</h2>
        </div>
        <div className="msw-head-tools">
          <button
            type="button"
            className="rcx-tool"
            data-active={mode === "guided" ? "true" : undefined}
            onClick={() => onModeChange("guided")}
          >
            Sentence
          </button>
          <button
            type="button"
            className="rcx-tool"
            data-active={mode === "advanced" ? "true" : undefined}
            onClick={() => onModeChange("advanced")}
          >
            Advanced JSON
          </button>
          <span className="msw-live">
            <span className="msw-dot" />
            preview_metric · live
            {previewMs != null ? ` · ${previewMs} ms` : ""}
          </span>
          <span className="rcx-chip msw-defchip">
            {fieldErrors ? "schema error" : "in grammar"}
          </span>
        </div>
      </header>

      {mode === "advanced" ? (
        <div className="msw-advanced">
          <label className="msw-fl" style={{ display: "block", marginBottom: 6 }}>
            Name
            <input
              className="msw-txtin"
              style={{ marginTop: 4 }}
              value={name}
              onChange={(e) => {
                setNameTouched(true);
                onNameChange(e.target.value);
              }}
            />
          </label>
          <label className="msw-fl" style={{ display: "block", marginBottom: 10 }}>
            Description
            <input
              className="msw-txtin"
              style={{ marginTop: 4 }}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </label>
          {showScope ? (
            <label className="msw-fsub" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={scopeGeneral}
                onChange={(e) => onScopeGeneralChange(e.target.checked)}
              />
              General (tenant-wide)
            </label>
          ) : null}
          <p className="rcx-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Raw definition JSON. Invalid combos surface as schema errors on
            preview/save — no crash.
          </p>
          <textarea
            className="msw-json"
            value={jsonText}
            onChange={(e) => onJsonTextChange(e.target.value)}
          />
          {fieldErrors ? (
            <p className="msw-err" role="alert">
              {fieldErrors}
            </p>
          ) : null}
          {previewComparison ? (
            <MetricComparisonChart comparison={previewComparison} />
          ) : null}
          {previewSeries?.points ? (
            <MetricChart
              points={previewSeries.points}
              referenceLines={previewSeries.reference_lines}
              chartHint={previewSeries.chart_hint ?? "column"}
            />
          ) : null}
          <div className="msw-foot" style={{ borderTop: "none", padding: "12px 0" }}>
            <button type="button" className="rcx-tool" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="rcx-tool primary"
              disabled={busy === "save" || !name.trim()}
              onClick={onSave}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="msw-body">
            <div className="msw-form">
              <div className="msw-steps">
                <span className="msw-kick">
                  Step {stepIndex + 1} of {WZ_STEPS.length}
                </span>
                <h3>{WZ_STEPS[stepIndex][1]}</h3>
              </div>
              {sentenceBlock}
              {formFields}
            </div>
            {previewPanel}
          </div>
          <footer className="msw-foot">
            <span className="msw-meta">
              Every control writes one grammar field. Preview is read-only{" "}
              <code>preview_metric</code>.
            </span>
            <button type="button" className="rcx-tool" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="rcx-tool primary"
              disabled={busy === "save" || !name.trim()}
              onClick={onSave}
            >
              Save
            </button>
          </footer>
          <footer className="msw-foot-m">
            <button
              type="button"
              className="rcx-tool"
              hidden={stepIndex === 0}
              onClick={() => moveStep(-1)}
            >
              ‹ Back
            </button>
            <div className="msw-dots" aria-hidden="true">
              {WZ_STEPS.map((s, j) => (
                <i
                  key={s[0]}
                  className={j === stepIndex ? "on" : j < stepIndex ? "done" : ""}
                />
              ))}
            </div>
            {!isLastStep ? (
              <button
                type="button"
                className="rcx-tool primary"
                onClick={() => moveStep(1)}
              >
                Next ›
              </button>
            ) : (
              <button
                type="button"
                className="rcx-tool primary"
                disabled={busy === "save" || !name.trim()}
                onClick={onSave}
              >
                Save
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

const MSW_CSS = `
.msw-root{background:var(--paper,#FCFBF9);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.msw-head{display:flex;align-items:center;gap:12px;padding:14px 18px 12px;border-bottom:1px solid var(--line,#DED9D1);flex-wrap:wrap}
.msw-kick{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700}
.msw-title{font-size:17px;font-weight:700;color:var(--ink,#1A1A1B);margin:2px 0 0}
.msw-head-tools{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.msw-live{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--accent-ink,#8a6a2a);background:color-mix(in srgb,var(--accent,#EBC06D) 22%,transparent);border:1px solid var(--accent,#EBC06D);border-radius:999px;padding:3px 10px;font-weight:700}
.msw-dot{width:7px;height:7px;border-radius:50%;background:var(--accent,#EBC06D);animation:mswpulse 1.4s infinite}
@keyframes mswpulse{0%,100%{opacity:1}50%{opacity:.35}}
.msw-body{display:grid;grid-template-columns:minmax(0,1fr) min(400px,42%);gap:0;flex:1;min-height:0}
.msw-form{padding:16px 18px 20px;overflow:auto;border-right:1px solid var(--line,#DED9D1)}
.msw-prev{padding:16px 16px 18px;overflow:auto;background:var(--canvas,#eef3f9)}
.msw-sentence{font-size:18px;line-height:2;color:var(--ink,#1A1A1B);font-weight:500;letter-spacing:-.005em;margin-bottom:10px}
.msw-sentence .msw-w{display:inline-flex;align-items:center;position:relative;margin:0 2px}
.msw-sentence select,.msw-sentence input{appearance:none;-webkit-appearance:none;font:inherit;font-size:18px;font-weight:700;color:var(--brand,#2C3E50);background:color-mix(in srgb,var(--brand,#2C3E50) 6%,transparent);border:0;border-bottom:2px solid color-mix(in srgb,var(--brand,#2C3E50) 35%,transparent);border-radius:6px 6px 0 0;padding:0 8px;cursor:pointer;line-height:1.5;max-width:220px}
.msw-sentence input{cursor:text;min-width:100px}
.msw-sentence select:hover,.msw-sentence input:hover{background:color-mix(in srgb,var(--brand,#2C3E50) 10%,transparent);border-bottom-color:var(--brand,#2C3E50)}
.msw-soft{color:var(--mute);font-weight:400}
.msw-fgrp{display:grid;grid-template-columns:140px minmax(0,1fr);gap:6px 14px;align-items:start;padding:12px 0;border-top:1px solid var(--line,#DED9D1)}
.msw-fl{font-size:12.5px;font-weight:700;color:var(--ink,#1A1A1B);padding-top:6px}
.msw-sub{display:block;font-size:10.5px;font-weight:600;color:var(--mute);letter-spacing:.04em;margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.msw-seg{display:inline-flex;padding:3px;border:1px solid var(--line,#DED9D1);border-radius:10px;background:var(--paper,#FCFBF9);gap:3px;flex-wrap:wrap}
.msw-seg button{position:relative;font:inherit;font-size:12.5px;font-weight:600;border:0;background:transparent;color:var(--slate,#4a5560);border-radius:7px;padding:6px 11px;cursor:pointer}
.msw-seg button[aria-selected="true"]{background:var(--brand,#2C3E50);color:#fff}
.msw-seg button:disabled{cursor:not-allowed}
.msw-fsub{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:13px;color:var(--slate,#4a5560)}
.msw-fsub select,.msw-fsub input[type="month"],.msw-fsub input:not([type="checkbox"]){font:inherit;font-size:13px;border:1px solid var(--line,#DED9D1);border-radius:6px;padding:4px 8px;background:#fff}
.msw-fnote{font-size:12px;color:var(--mute);margin:8px 0 0;line-height:1.45}
.msw-txtin{width:100%;font:inherit;font-size:13.5px;border:1px solid var(--line,#DED9D1);border-radius:8px;padding:8px 10px;background:#fff;color:var(--ink,#1A1A1B)}
.msw-prev-card{background:var(--paper,#FCFBF9);border:1px solid var(--line,#DED9D1);border-radius:10px;padding:12px 14px;margin-bottom:12px}
.msw-ph{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.msw-ph h3{font-size:15px;font-weight:700;margin:0;flex:1;min-width:0}
.msw-prev-fig{display:flex;align-items:flex-end;gap:16px;margin:10px 0 6px;flex-wrap:wrap}
.msw-tile-l{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);font-weight:700}
.msw-tile-n{font-size:28px;font-weight:700;color:var(--ink,#1A1A1B);letter-spacing:-.01em}
.msw-prev-chart{margin-top:8px}
.msw-def{margin-top:10px;border-top:1px solid var(--line,#DED9D1);padding-top:8px}
.msw-def summary{font-size:12px;font-weight:700;color:var(--brand,#2C3E50);cursor:pointer;letter-spacing:.06em;text-transform:uppercase;list-style:none;display:flex;align-items:center;gap:8px}
.msw-def pre{margin:8px 0 0;padding:10px;background:color-mix(in srgb,var(--canvas,#eef3f9) 70%,#fff);border-radius:8px;font-size:11.5px;overflow:auto;max-height:240px;color:var(--ink,#1A1A1B)}
.msw-err{font-size:12.5px;color:var(--su-neg,#b23a2e);background:color-mix(in srgb,var(--su-neg,#b23a2e) 8%,#fff);border:1px solid color-mix(in srgb,var(--su-neg,#b23a2e) 28%,var(--line));border-radius:8px;padding:8px 10px;margin-top:10px}
.msw-foot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--line,#DED9D1);background:var(--paper,#FCFBF9)}
.msw-meta{flex:1;min-width:0;font-size:12px;color:var(--mute)}
.msw-meta code{font-size:11px}
.msw-foot-m,.msw-steps,.msw-wzm-def,.msw-defchip{display:none}
.msw-advanced{padding:16px 18px}
.msw-json{width:100%;min-height:220px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;border:1px solid var(--line,#DED9D1);border-radius:8px;padding:10px;background:#fff}
.msw-root .rcx-tool[data-active="true"]{background:var(--brand,#2C3E50);border-color:var(--brand,#2C3E50);color:#fff}

/* phone / tablet */
[data-bp="phone"] .msw-body,[data-bp="tablet"] .msw-body{display:flex;flex-direction:column}
[data-bp="phone"] .msw-prev,[data-bp="tablet"] .msw-prev{display:block;order:-1;flex:0 0 auto;padding:10px 14px;border-bottom:1px solid var(--line,#DED9D1);overflow:visible}
[data-bp="phone"] .msw-prev .msw-def,[data-bp="tablet"] .msw-prev .msw-def{display:none}
[data-bp="phone"] .msw-form,[data-bp="tablet"] .msw-form{border-right:0;padding:14px 16px 20px}
[data-bp="phone"] .msw-steps{display:block;margin-bottom:10px}
[data-bp="phone"] .msw-steps h3{font-size:18px;margin:2px 0 0;font-weight:700}
[data-bp="phone"] .msw-fgrp,[data-bp="phone"] .msw-sentence{display:none}
[data-bp="phone"][data-step="what"] .msw-sentence,[data-bp="phone"][data-step="what"] .msw-fgrp[data-step="what"]{display:grid}
[data-bp="phone"][data-step="what"] .msw-sentence{display:block}
[data-bp="phone"][data-step="cadence"] .msw-fgrp[data-step="cadence"],
[data-bp="phone"][data-step="window"] .msw-fgrp[data-step="window"],
[data-bp="phone"][data-step="compare"] .msw-fgrp[data-step="compare"],
[data-bp="phone"][data-step="finish"] .msw-fgrp[data-step="finish"]{display:grid}
[data-bp="phone"] .msw-fgrp{grid-template-columns:1fr}
[data-bp="phone"] .msw-sentence{font-size:20px;line-height:2.05}
[data-bp="phone"] .msw-sentence select,[data-bp="phone"] .msw-sentence input{font-size:20px}
[data-bp="phone"] .msw-foot{display:none}
[data-bp="phone"] .msw-foot-m{display:flex;align-items:center;gap:8px;padding:10px 14px 12px;border-top:1px solid var(--line,#DED9D1);background:var(--paper,#FCFBF9)}
.msw-dots{flex:1;display:flex;justify-content:center;gap:6px;align-items:center}
.msw-dots i{width:7px;height:7px;border-radius:50%;background:var(--canvas-2,#d5dde8);display:block;transition:all .2s}
.msw-dots i.on{background:var(--brand,#2C3E50);width:18px;border-radius:4px}
.msw-dots i.done{background:var(--brand-2,#3d5166);opacity:.6}
[data-bp="phone"] .msw-wzm-def,[data-bp="tablet"] .msw-wzm-def{display:block}
[data-bp="tablet"] .msw-defchip{display:inline-flex}
[data-bp="phone"] .msw-head .rcx-chip:not(.msw-defchip){display:none}
`;
