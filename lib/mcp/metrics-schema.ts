import { z } from "zod";

const OPS = ["avg", "sum", "stddev", "min", "max", "yoy", "pct_of", "count"] as const;
const SOURCE_TYPES = ["bucket", "category", "account", "metric"] as const;
const DIRECTIONS = ["in", "out", "any"] as const;
const WINDOW_KINDS = ["trailing", "calendar_year", "ytd", "all"] as const;
const OF_KINDS = ["monthly_totals"] as const;

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
    } else if (!s.key?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message: "source.key required for bucket|category|account",
      });
    }
  });

const windowSchema = z.object({
  kind: z.enum(WINDOW_KINDS),
  months: z.number().int().positive().optional(),
});

export type MetricSource = z.infer<typeof metricSourceSchema>;
export type MetricWindow = z.infer<typeof windowSchema>;

export type MetricDefinition = {
  of: (typeof OF_KINDS)[number];
  source: MetricSource;
  op: (typeof OPS)[number];
  window: MetricWindow;
  of2?: MetricDefinition;
};

const metricDefinitionSchema: z.ZodType<MetricDefinition> = z.lazy(() =>
  z
    .object({
      of: z.enum(OF_KINDS),
      source: metricSourceSchema,
      op: z.enum(OPS),
      window: windowSchema,
      of2: metricDefinitionSchema.optional(),
    })
    .superRefine((d, ctx) => {
      if (d.op === "pct_of" && !d.of2) {
        ctx.addIssue({
          code: "custom",
          path: ["of2"],
          message: "of2 required for pct_of",
        });
      }
      if (d.window.kind === "trailing" && !(d.window.months && d.window.months > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["window", "months"],
          message: "window.months required for trailing",
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
