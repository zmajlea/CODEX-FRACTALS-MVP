import { z } from "zod";

const OPS = ["avg", "sum", "stddev", "min", "max", "yoy", "pct_of", "count"] as const;
const SOURCE_TYPES = ["bucket", "category", "account", "metric"] as const;
const DIRECTIONS = ["in", "out", "any"] as const;
const WINDOW_KINDS = ["trailing", "calendar_year", "ytd", "all"] as const;
const OF_KINDS = ["monthly_totals", "series_totals"] as const;
const SUBDIVISIONS = ["day", "week", "month", "quarter", "year"] as const;
const BUCKET_OPS = ["sum", "count", "avg", "min", "max"] as const;
const REF_KINDS = ["avg", "min", "max", "target", "threshold"] as const;
const REF_STATS = ["avg", "min", "max", "median"] as const;
const BREACH_MODES = ["none", "flag"] as const;
const CHART_HINTS = ["column", "line"] as const;

/** Reject definitions whose expected bucket count exceeds this. */
export const METRIC_POINT_CAP = 400;

const metricSourceSchema = z
  .object({
    type: z.enum(SOURCE_TYPES),
    key: z.string().min(1).optional(),
    direction: z.enum(DIRECTIONS).optional().default("any"),
    ref: z.string().min(1).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.type === "metric") {
      if (!s.ref?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["ref"],
          message: "source.ref required when type is metric",
        });
      }
    } else if (!s.key?.trim() && s.type !== "account") {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "source.key required for bucket|category",
      });
    }
  });

const windowSchema = z.object({
  kind: z.enum(WINDOW_KINDS),
  months: z.number().int().positive().optional(),
});

const referenceLineSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(REF_KINDS),
    value: z.number().optional(),
    stat: z.enum(REF_STATS).optional(),
    breach: z.enum(BREACH_MODES).optional().default("none"),
  })
  .superRefine((line, ctx) => {
    const hasValue = line.value !== undefined;
    const hasStat = line.stat !== undefined;
    if (hasValue === hasStat) {
      ctx.addIssue({
        code: "custom",
        path: hasValue ? ["value"] : ["stat"],
        message: "reference line requires exactly one of value|stat",
      });
    }
  });

export type MetricSource = z.infer<typeof metricSourceSchema>;
export type MetricWindow = z.infer<typeof windowSchema>;
export type MetricSubdivision = (typeof SUBDIVISIONS)[number];
export type MetricBucketOp = (typeof BUCKET_OPS)[number];
export type MetricReferenceLine = z.infer<typeof referenceLineSchema>;
export type MetricChartHint = (typeof CHART_HINTS)[number];
export type MetricKind = "value" | "analytics";

export type MetricDefinition = {
  of: (typeof OF_KINDS)[number];
  source: MetricSource;
  op?: (typeof OPS)[number];
  window: MetricWindow;
  of2?: MetricDefinition;
  subdivision?: MetricSubdivision;
  bucket_op?: MetricBucketOp;
  reference_lines?: MetricReferenceLine[];
  chart_hint?: MetricChartHint;
};

export function kindFromDefinition(def: {
  subdivision?: string | null;
}): MetricKind {
  return def.subdivision ? "analytics" : "value";
}

/** Rough upper bound on buckets for (subdivision × window). */
export function estimateBucketCount(
  subdivision: MetricSubdivision,
  window: MetricWindow
): number {
  const monthsSpan =
    window.kind === "trailing"
      ? (window.months ?? 3)
      : window.kind === "calendar_year" || window.kind === "ytd"
        ? 12
        : /* all — assume long history so fine subdivisions fail the cap */
          480;

  switch (subdivision) {
    case "day":
      return Math.ceil(monthsSpan * 31);
    case "week":
      return Math.ceil(monthsSpan * (52 / 12));
    case "month":
      return monthsSpan;
    case "quarter":
      return Math.ceil(monthsSpan / 3);
    case "year":
      return Math.ceil(monthsSpan / 12);
    default:
      return METRIC_POINT_CAP + 1;
  }
}

const metricDefinitionSchema: z.ZodType<MetricDefinition> = z.lazy(() =>
  z
    .object({
      of: z.enum(OF_KINDS),
      source: metricSourceSchema,
      op: z.enum(OPS).optional(),
      window: windowSchema,
      of2: metricDefinitionSchema.optional(),
      subdivision: z.enum(SUBDIVISIONS).optional(),
      bucket_op: z.enum(BUCKET_OPS).optional(),
      reference_lines: z.array(referenceLineSchema).optional(),
      chart_hint: z.enum(CHART_HINTS).optional(),
    })
    .superRefine((d, ctx) => {
      const kind = kindFromDefinition(d);

      if (d.window.kind === "trailing" && !(d.window.months && d.window.months > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["window", "months"],
          message: "window.months required for trailing",
        });
      }

      if (kind === "value") {
        if (!d.op) {
          ctx.addIssue({
            code: "custom",
            path: ["op"],
            message: "op required for value metrics",
          });
        }
        if (d.subdivision) {
          ctx.addIssue({
            code: "custom",
            path: ["subdivision"],
            message: "subdivision not allowed on value metrics",
          });
        }
        if (d.bucket_op !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["bucket_op"],
            message: "bucket_op not allowed on value metrics",
          });
        }
        if (d.reference_lines?.length) {
          ctx.addIssue({
            code: "custom",
            path: ["reference_lines"],
            message: "reference_lines not allowed on value metrics",
          });
        }
        if (d.chart_hint !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["chart_hint"],
            message: "chart_hint not allowed on value metrics",
          });
        }
      } else {
        if (!d.subdivision) {
          ctx.addIssue({
            code: "custom",
            path: ["subdivision"],
            message: "subdivision required for analytics metrics",
          });
        } else {
          const estimate = estimateBucketCount(d.subdivision, d.window);
          if (estimate > METRIC_POINT_CAP) {
            ctx.addIssue({
              code: "custom",
              path: ["subdivision"],
              message: `point cap exceeded (~${estimate} buckets > ${METRIC_POINT_CAP}); narrow the window or coarsen subdivision`,
            });
          }
        }
      }

      if (d.op === "pct_of" && !d.of2) {
        ctx.addIssue({
          code: "custom",
          path: ["of2"],
          message: "of2 required for pct_of",
        });
      }
    })
);

/** Reject SQL-ish / freeform payloads before grammar parse. */
export function looksLikeSql(raw: unknown): string | null {
  const blob = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  if (/\b(select|insert|update|delete|drop|alter|union|exec|execute)\b/i.test(blob)) {
    return "definition must be declarative JSON — SQL is not allowed";
  }
  if (/;|--|\/\*|\*\//.test(blob)) {
    return "definition must be declarative JSON — SQL fragments are not allowed";
  }
  return null;
}

export type MetricValidationError = { path: string; message: string };

export function validateMetricDefinition(
  raw: unknown
):
  | { ok: true; definition: MetricDefinition }
  | { ok: false; errors: MetricValidationError[] } {
  const sqlErr = looksLikeSql(raw);
  if (sqlErr) {
    return { ok: false, errors: [{ path: "definition", message: sqlErr }] };
  }

  const parsed = metricDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "definition",
        message: i.message,
      })),
    };
  }
  return { ok: true, definition: parsed.data };
}

/** Collect metric name refs for cycle / resolve checks. */
export function collectMetricRefs(def: MetricDefinition, out = new Set<string>()) {
  if (def.source.type === "metric" && def.source.ref) {
    out.add(def.source.ref.trim());
  }
  if (def.of2) collectMetricRefs(def.of2, out);
  return out;
}

export const METRIC_OPS = OPS;
export const METRIC_SOURCE_TYPES = SOURCE_TYPES;
export const METRIC_SUBDIVISIONS = SUBDIVISIONS;
export const METRIC_BUCKET_OPS = BUCKET_OPS;
export const METRIC_CHART_HINTS = CHART_HINTS;
export const METRIC_REF_KINDS = REF_KINDS;
export const METRIC_REF_STATS = REF_STATS;
