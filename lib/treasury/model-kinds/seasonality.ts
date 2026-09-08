/**
 * seasonality — decompose a subject series into calendar-month indices.
 */
import { z } from "zod";
import {
  computeSeasonalIndices,
  deriveCompleteMonths,
  meanOfMonths,
  partitionIntoYearBlocks,
  toExcludedSet,
} from "@/lib/treasury/spend-plan";
import {
  scrubPlacedStudySnapshot,
  normalizePlacedStudy,
  type PlacedStudySnapshot,
} from "@/lib/treasury/study-assemble";
import {
  buildSubjectSeries,
  type ForecastSubject,
} from "@/lib/treasury/model-kinds/subject-series";
import type { ModelKindDef, ModelRowLike } from "@/lib/treasury/model-kinds/types";
import {
  confidenceGradeFromDerived,
  defaultStatusPlaceable,
} from "@/lib/treasury/model-kinds/types";

const subjectSchema = z.object({
  kind: z.enum(["total_in", "total_out", "net", "bucket", "category"]),
  id: z.string().optional(),
});

export const seasonalityParamsSchema = z.object({
  subject: subjectSchema.default({ kind: "total_out" }),
  method: z.enum(["block", "ratio_to_trailing12"]).default("block"),
  excludedMonths: z.array(z.string()).default([]),
});

export type SeasonalityParams = z.infer<typeof seasonalityParamsSchema>;

export type SeasonalityComputeResult = {
  asOf: string;
  indices: Record<number, number>;
  sampleCounts: Record<number, number>;
  cyclesObserved: number;
  completeCount: number;
  orphanMonths: number;
  method: "block" | "ratio_to_trailing12";
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function ratioToTrailing12(
  series: Record<string, number>,
  complete: string[],
  excluded: Set<string>
): { indices: Record<number, number>; sampleCounts: Record<number, number> } {
  const byCal: Record<number, number[]> = {};
  for (let m = 1; m <= 12; m++) byCal[m] = [];

  const sorted = [...complete].sort();
  for (let i = 0; i < sorted.length; i++) {
    const key = sorted[i]!;
    if (excluded.has(key.slice(0, 7))) continue;
    const idx = sorted.indexOf(key);
    if (idx < 11) continue;
    const window = sorted.slice(idx - 11, idx + 1).filter(
      (k) => !excluded.has(k.slice(0, 7))
    );
    const mean = meanOfMonths(series, window);
    if (mean === 0) continue;
    const cal = Number(key.slice(5, 7));
    byCal[cal]!.push((series[key] ?? 0) / mean);
  }

  const indices: Record<number, number> = {};
  const sampleCounts: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const ratios = byCal[m]!;
    sampleCounts[m] = ratios.length;
    indices[m] =
      ratios.length === 0
        ? 1
        : ratios.reduce((s, v) => s + v, 0) / ratios.length;
  }
  return { indices, sampleCounts };
}

export const seasonalityKind: ModelKindDef<
  SeasonalityParams,
  unknown[],
  SeasonalityComputeResult
> = {
  type: "seasonality",
  label: "Seasonality",
  description: "Which months run hot or cold relative to an average month?",
  family: "decomposition",
  listed: true,
  params: seasonalityParamsSchema,
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
        {
          value: "block",
          label: "Year blocks",
          help: "Tim's block seasonality (orphan months unused)",
        },
        {
          value: "ratio_to_trailing12",
          label: "Ratio to trailing 12",
        },
      ],
    },
    { key: "excludedMonths", label: "Excluded months", kind: "exclude_months" },
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
    const excluded = toExcludedSet(params.excludedMonths);
    const complete = deriveCompleteMonths(series, asOf).filter(
      (m) => !excluded.has(m.slice(0, 7))
    );

    let indices: Record<number, number>;
    let sampleCounts: Record<number, number>;

    if (params.method === "ratio_to_trailing12") {
      const r = ratioToTrailing12(series, complete, excluded);
      indices = r.indices;
      sampleCounts = r.sampleCounts;
    } else {
      const season = computeSeasonalIndices(
        series,
        Object.keys(series),
        asOf,
        params.excludedMonths
      );
      indices = season.indices;
      sampleCounts = season.sampleCounts;
    }

    const blocks = partitionIntoYearBlocks(complete);
    const cyclesObserved = blocks.length;
    const orphanMonths = complete.length - cyclesObserved * 12;

    return {
      asOf,
      indices,
      sampleCounts,
      cyclesObserved,
      completeCount: complete.length,
      orphanMonths: Math.max(0, orphanMonths),
      method: params.method,
    };
  },
  confidence(_inputs, _params, result) {
    const n = result.completeCount;
    if (n < 12) {
      return {
        grade: "refused",
        reasons: [`seasonality needs 12 complete months; ${n} available`],
        historyMonthCount: n,
      };
    }
    const reasons = [
      `${result.cyclesObserved} seasonal cycle${result.cyclesObserved === 1 ? "" : "s"} observed`,
    ];
    if (result.method === "block" && n === 18) {
      reasons.push(
        "6 orphan months unused; every calendar month sampled once"
      );
    } else if (result.orphanMonths > 0 && result.method === "block") {
      reasons.push(`${result.orphanMonths} orphan months unused`);
    }
    return {
      grade: "indicative",
      reasons,
      historyMonthCount: n,
      cyclesObserved: result.cyclesObserved,
    };
  },
  toSnapshot(row, _inputs, _params, _scenarios, result) {
    let peakM = 1;
    let troughM = 1;
    for (let m = 1; m <= 12; m++) {
      if ((result.indices[m] ?? 1) > (result.indices[peakM] ?? 1)) peakM = m;
      if ((result.indices[m] ?? 1) < (result.indices[troughM] ?? 1)) troughM = m;
    }
    const peak = result.indices[peakM] ?? 1;
    const trough = result.indices[troughM] ?? 1;
    const amplitude = trough === 0 ? peak : peak / trough;

    const points = MONTH_LABELS.map((label, i) => ({
      label,
      value: result.indices[i + 1] ?? 1,
    }));

    const kpis = [
      {
        id: "kpi-0",
        label: "Peak month",
        value: MONTH_LABELS[peakM - 1]!,
        layout: { w: 3, h: 1 },
      },
      {
        id: "kpi-1",
        label: "Trough month",
        value: MONTH_LABELS[troughM - 1]!,
        layout: { w: 3, h: 1 },
      },
      {
        id: "kpi-2",
        label: "Amplitude",
        value: Math.round(amplitude * 100) / 100,
        layout: { w: 3, h: 1 },
      },
      {
        id: "kpi-3",
        label: "Cycles observed",
        value: result.cyclesObserved,
        layout: { w: 3, h: 1 },
      },
    ];

    const snap: PlacedStudySnapshot = normalizePlacedStudy({
      kind: "study",
      study_id: String(row.id ?? "preview"),
      name: String(row.name ?? "Seasonality"),
      type: "seasonality",
      as_of: result.asOf,
      kpis,
      timeline: null,
      exhibits: [
        {
          id: "seasonality-0",
          title: "Seasonal index",
          chart_hint: "column",
          series_kind: "analytics",
          points,
          reference_lines: [{ label: "average month", value: 1 }],
          layout: { w: 12, h: 2 },
        },
      ],
      notes: [],
      scenarios: null,
      narrative: [],
      recommendations: [],
    });
    return scrubPlacedStudySnapshot(snap);
  },
  explain(params, result) {
    const method =
      params.method === "block"
        ? "Year-block seasonal indices"
        : "Ratio to trailing-12 mean";
    const excl =
      params.excludedMonths?.length > 0
        ? `; ${params.excludedMonths.map((m) => m.slice(0, 7)).join(", ")} excluded`
        : "";
    return `${method} on ${params.subject.kind}; ${result.cyclesObserved} cycle(s)${excl}.`;
  },
  derived(result, inputs, params) {
    const conf = seasonalityKind.confidence(inputs, params, result);
    return {
      asOf: result.asOf,
      confidence: conf,
      method: params.method,
      subject: params.subject,
      indices: result.indices,
      sampleCounts: result.sampleCounts,
      cyclesObserved: result.cyclesObserved,
      historyMonthCount: result.completeCount,
    };
  },
};

export function seasonalityRowPlaceable(row: ModelRowLike): boolean {
  return seasonalityKind.placeable(row);
}
