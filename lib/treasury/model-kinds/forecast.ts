/**
 * forecast — project a subject series (run-rate / linear_trend / yoy_growth).
 */
import { z } from "zod";
import {
  computeSeasonalIndices,
  deriveCompleteMonths,
  toExcludedSet,
} from "@/lib/treasury/spend-plan";
import {
  projectSeries,
  type ProjectionMethod,
  type ProjectedPoint,
} from "@/lib/treasury/projection";
import {
  scrubPlacedStudySnapshot,
  normalizePlacedStudy,
  type PlacedStudySnapshot,
} from "@/lib/treasury/study-assemble";
import {
  buildSubjectSeries,
  type ForecastSubject,
} from "@/lib/treasury/model-kinds/subject-series";
import type {
  Confidence,
  ModelKindDef,
  ModelRowLike,
} from "@/lib/treasury/model-kinds/types";
import {
  confidenceGradeFromDerived,
  defaultStatusPlaceable,
} from "@/lib/treasury/model-kinds/types";

const subjectSchema = z.object({
  kind: z.enum(["total_in", "total_out", "net", "bucket", "category"]),
  id: z.string().optional(),
});

export const forecastParamsSchema = z.object({
  subject: subjectSchema.default({ kind: "total_out" }),
  method: z
    .enum(["run_rate", "linear_trend", "yoy_growth"])
    .default("run_rate"),
  window: z.number().int().min(3).max(12).default(6),
  horizon: z.number().int().min(1).max(24).default(6),
  seasonal: z.boolean().default(false),
  excludedMonths: z.array(z.string()).default([]),
  hold: z.number().nullable().optional(),
});

export type ForecastParams = z.infer<typeof forecastParamsSchema>;

export type ForecastComputeResult = {
  asOf: string;
  historical: ProjectedPoint[];
  projected: ProjectedPoint[];
  trendPerMonth: number;
  windowMean: number;
  completeCount: number;
  seasonalGrade: Confidence["grade"] | null;
  seasonalReasons: string[];
  method: ProjectionMethod;
};

function methodLabel(m: ProjectionMethod, window: number): string {
  if (m === "run_rate") return `Run-rate of the last ${window} complete months`;
  if (m === "linear_trend") return `Linear trend over the last ${window} complete months`;
  return "Year-over-year growth (TTM)";
}

export const forecastKind: ModelKindDef<
  ForecastParams,
  unknown[],
  ForecastComputeResult
> = {
  type: "forecast",
  label: "Forecast",
  description: "What happens to this series over the next N months?",
  family: "projection",
  listed: true,
  params: forecastParamsSchema,
  scenarios: z.array(z.unknown()),
  form: [
    {
      key: "subject",
      label: "Subject",
      kind: "select",
      options: [
        { value: "total_out", label: "Total outflows" },
        { value: "total_in", label: "Total inflows" },
        { value: "net", label: "Net cash" },
        { value: "bucket", label: "Bucket", help: "Requires subject.id" },
        { value: "category", label: "Category", help: "Requires subject.id" },
      ],
    },
    {
      key: "method",
      label: "Method",
      kind: "select",
      options: [
        { value: "run_rate", label: "Run-rate" },
        { value: "linear_trend", label: "Linear trend" },
        {
          value: "yoy_growth",
          label: "YoY growth",
          disabledReason: "needs 24 complete months",
        },
      ],
    },
    { key: "window", label: "Window (months)", kind: "months", min: 3, max: 12 },
    { key: "horizon", label: "Horizon (months)", kind: "months", min: 1, max: 24 },
    { key: "seasonal", label: "Apply seasonality", kind: "toggle" },
    { key: "excludedMonths", label: "Excluded months", kind: "exclude_months" },
    { key: "hold", label: "Hold (manual)", kind: "money", seed: true },
  ],
  inputs: ["monthly_by_category"],
  placeable(row) {
    if (!defaultStatusPlaceable(row.status)) return false;
    return confidenceGradeFromDerived(row.derived_snapshot) !== "refused";
  },
  asOf(row) {
    const d = row.derived_snapshot as { asOf?: string } | null;
    return String(d?.asOf ?? "").slice(0, 10);
  },
  compute(inputs, params) {
    const loaded = inputs.cashModel;
    if (!loaded) return null;
    const asOf = loaded.asOf;
    const subject = params.subject as ForecastSubject;
    const series = buildSubjectSeries(
      loaded.categorySeries,
      subject,
      {}
    );

    // Manual hold replaces the series level via a constant run-rate path.
    let working = series;
    if (params.hold != null && Number.isFinite(params.hold)) {
      working = { ...series };
      for (const k of Object.keys(working)) working[k] = params.hold;
    }

    const excluded = params.excludedMonths ?? [];
    const complete = deriveCompleteMonths(working, asOf).filter(
      (m) => !toExcludedSet(excluded).has(m.slice(0, 7))
    );

    let seasonalIndex: Record<number, number> | null = null;
    let seasonalGrade: Confidence["grade"] | null = null;
    let seasonalReasons: string[] = [];
    if (params.seasonal) {
      const season = computeSeasonalIndices(
        working,
        Object.keys(working),
        asOf,
        excluded
      );
      if (season.seasonalityDisabled || complete.length < 12) {
        seasonalGrade = "refused";
        seasonalReasons = [
          `seasonality needs 12 complete months; ${complete.length} available`,
        ];
      } else {
        seasonalIndex = season.indices;
        const cycles = Math.floor(complete.length / 12);
        seasonalGrade = "indicative";
        seasonalReasons = [
          `${cycles} seasonal cycle${cycles === 1 ? "" : "s"} observed`,
        ];
        if (complete.length === 18) {
          seasonalReasons.push(
            "6 orphan months unused; every calendar month sampled once"
          );
        }
      }
    }

    const method = params.method as ProjectionMethod;
    const out = projectSeries({
      series: working,
      asOf,
      method,
      window: params.window,
      horizon: params.horizon,
      excludedMonths: excluded,
      seasonalIndex,
    });

    const windowKeys = complete.slice(-params.window);
    const windowMean =
      windowKeys.length === 0
        ? 0
        : windowKeys.reduce((s, k) => s + (working[k] ?? 0), 0) /
          windowKeys.length;

    return {
      asOf,
      historical: out.historical,
      projected: out.projected,
      trendPerMonth: out.trendPerMonth,
      windowMean,
      completeCount: complete.length,
      seasonalGrade,
      seasonalReasons,
      method,
    };
  },
  confidence(_inputs, params, result) {
    const n = result.completeCount;
    let conf: Confidence;

    if (params.method === "yoy_growth") {
      if (n < 24 || result.projected.length === 0) {
        conf = {
          grade: "refused",
          reasons: [`needs 24 complete months; ${n} available`],
          historyMonthCount: n,
        };
      } else {
        conf = {
          grade: "solid",
          reasons: [`${n} history months`],
          historyMonthCount: n,
          cyclesObserved: Math.floor(n / 12),
        };
      }
    } else if (params.method === "linear_trend") {
      if (n < 3 || result.projected.length === 0) {
        conf = {
          grade: "refused",
          reasons: [`needs 3 complete months; ${n} available`],
          historyMonthCount: n,
        };
      } else if (n < 12) {
        conf = {
          grade: "indicative",
          reasons: [`${n} history months — under one seasonal cycle`],
          historyMonthCount: n,
        };
      } else {
        conf = {
          grade: "solid",
          reasons: [`${n} history months`],
          historyMonthCount: n,
          cyclesObserved: Math.floor(n / 12),
        };
      }
      if (result.projected.length > 0 && result.windowMean !== 0) {
        const end = result.projected[result.projected.length - 1]!.value;
        const pct = Math.abs(end / result.windowMean - 1);
        if (pct > 0.4) {
          conf = {
            ...conf,
            reasons: [
              ...conf.reasons,
              "Trend implies > ±40% change over the horizon — consider run-rate",
            ],
          };
        }
      }
    } else {
      // run_rate
      if (n < 3 || result.projected.length === 0) {
        conf = {
          grade: "refused",
          reasons: [`needs 3 complete months; ${n} available`],
          historyMonthCount: n,
        };
      } else {
        conf = {
          grade: "solid",
          reasons: [`${n} history months`],
          historyMonthCount: n,
        };
      }
    }

    // seasonal:true cannot raise grade above seasonality grade
    if (params.seasonal && result.seasonalGrade) {
      const order = { refused: 0, thin: 1, indicative: 2, solid: 3 } as const;
      if (order[result.seasonalGrade] < order[conf.grade]) {
        conf = {
          grade: result.seasonalGrade,
          reasons: [...result.seasonalReasons, ...conf.reasons],
          historyMonthCount: n,
          cyclesObserved: conf.cyclesObserved,
        };
      } else if (result.seasonalReasons.length) {
        conf = {
          ...conf,
          reasons: [...conf.reasons, ...result.seasonalReasons],
        };
      }
    }

    return conf;
  },
  toSnapshot(row, inputs, params, _scenarios, result) {
    const pts = [...result.historical, ...result.projected];
    const next1 = result.projected[0]?.value ?? null;
    const next3 = result.projected
      .slice(0, 3)
      .reduce((s, p) => s + p.value, 0);
    const horizonTotal = result.projected.reduce((s, p) => s + p.value, 0);
    const basis = params.hold != null ? "manual" : params.method;

    const kpis = [
      {
        id: "kpi-0",
        label: "Next month",
        value: next1 ?? "—",
        unit: next1 != null ? "usd" : undefined,
        basis,
        layout: { w: 3, h: 1 },
      },
      {
        id: "kpi-1",
        label: "Next 3 months",
        value: result.projected.length ? next3 : "—",
        unit: result.projected.length ? "usd" : undefined,
        basis,
        layout: { w: 3, h: 1 },
      },
      {
        id: "kpi-2",
        label: "Horizon total",
        value: result.projected.length ? horizonTotal : "—",
        unit: result.projected.length ? "usd" : undefined,
        basis,
        layout: { w: 3, h: 1 },
      },
      {
        id: "kpi-3",
        label: "Trend / month",
        value: result.trendPerMonth,
        unit: "usd",
        basis: params.method,
        layout: { w: 3, h: 1 },
      },
    ];

    const timeline = {
      points: pts.map((p) => ({
        month: p.month,
        ending: p.value,
        projected: p.projected,
      })),
      reference_lines: [
        { label: "Window mean", value: result.windowMean },
      ],
      chart_hint: "line" as const,
    };

    const conf = forecastKind.confidence(inputs, params, result);
    const assumptions: string[] = [
      `${params.method.replace(/_/g, " ")}, last ${params.window}`,
      `horizon ${params.horizon} mo`,
    ];
    if (params.seasonal) assumptions.push("seasonal shape");
    if (params.hold != null && Number.isFinite(params.hold)) {
      assumptions.push(
        `held at $${Math.round(params.hold).toLocaleString("en-US")}`
      );
    }
    if (params.excludedMonths?.length) {
      assumptions.push(
        `${params.excludedMonths.map((m) => m.slice(0, 7)).join(", ")} excluded`
      );
    }

    const snap: PlacedStudySnapshot = normalizePlacedStudy({
      kind: "study",
      study_id: String(row.id ?? "preview"),
      name: String(row.name ?? "Forecast"),
      type: "forecast",
      as_of: result.asOf,
      kpis,
      timeline,
      exhibits: [
        {
          id: "forecast-0",
          title: "Forecast",
          chart_hint: "line",
          series_kind: "cash",
          points: timeline.points,
          reference_lines: timeline.reference_lines,
          layout: { w: 12, h: 2 },
        },
      ],
      notes: [],
      scenarios: null,
      narrative: [],
      recommendations: [],
      assumptions,
      method_note: forecastKind.explain(params, result),
      confidence: {
        grade: conf.grade,
        note: conf.reasons[0],
      },
    });
    return scrubPlacedStudySnapshot(snap);
  },
  explain(params) {
    const excl =
      params.excludedMonths?.length > 0
        ? `; ${params.excludedMonths.map((m) => m.slice(0, 7)).join(", ")} excluded`
        : "";
    const seasonal = params.seasonal ? "; seasonal indices applied" : "";
    const hold = params.hold != null ? `; hold ${params.hold} (manual)` : "";
    return `${methodLabel(params.method, params.window)}, projected ${params.horizon} months${seasonal}${excl}${hold}.`;
  },
  derived(result, inputs, params) {
    const conf = forecastKind.confidence(inputs, params, result);
    return {
      asOf: result.asOf,
      confidence: conf,
      method: params.method,
      subject: params.subject,
      window: params.window,
      horizon: params.horizon,
      seasonal: params.seasonal,
      trendPerMonth: result.trendPerMonth,
      windowMean: result.windowMean,
      historyMonthCount: result.completeCount,
      projected: result.projected,
      historical: result.historical,
    };
  },
};

export function forecastRowPlaceable(row: ModelRowLike): boolean {
  return forecastKind.placeable(row);
}
