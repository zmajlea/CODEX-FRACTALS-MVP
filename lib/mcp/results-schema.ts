import { z } from "zod";

/** summit.results/v1 — operator-authored study payload (not the ledger). */

export const summitKpiSchema = z.object({
  label: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
});

export const summitNarrativeSchema = z.object({
  heading: z.string().optional(),
  body: z.string().min(1),
});

export const summitTimelineRowSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  beginning: z.number(),
  net: z.number(),
  ending: z.number(),
});

export const summitScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assumptions: z.record(z.string(), z.unknown()).optional(),
  timeline: z.array(summitTimelineRowSchema).min(1),
  breach_month: z.string().nullable().optional(),
  runway_months: z.number().nullable().optional(),
});

export const summitActualsCheckSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  category: z.string().min(1),
  inflow: z.number(),
  outflow: z.number(),
  net: z.number().optional(),
});

export const summitRecommendationSchema = z.object({
  kind: z.string().optional(),
  title: z.string().min(1),
  body: z.string().min(1),
  category: z.string().optional(),
});

export const summitResultsV1Schema = z.object({
  schema_version: z.literal("summit.results/v1").optional().default("summit.results/v1"),
  export_id: z.string().min(1),
  as_of: z.string().min(1),
  headline: z.string().min(1),
  kpis: z.array(summitKpiSchema).default([]),
  narrative: z.array(summitNarrativeSchema).default([]),
  scenarios: z.array(summitScenarioSchema).min(1),
  recommendations: z.array(summitRecommendationSchema).default([]),
  actuals_check: z.array(summitActualsCheckSchema).default([]),
  opening_balance: z.number().optional(),
  account_id: z.string().optional(),
});

/**
 * Spec B16 — manual Study editor may be KPI-only (no timeline/scenarios).
 * MCP submit_results still uses summitResultsV1Schema (scenarios required).
 */
export const summitManualResultsSchema = summitResultsV1Schema
  .extend({
    export_id: z.string().min(1).optional().default("manual"),
    scenarios: z.array(summitScenarioSchema).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.kpis.length === 0 && val.scenarios.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one KPI or a scenario timeline",
        path: ["kpis"],
      });
    }
  });

export type SummitResultsV1 = z.infer<typeof summitResultsV1Schema>;
export type SummitManualResults = z.infer<typeof summitManualResultsSchema>;

export function parseSummitResults(raw: unknown) {
  return summitResultsV1Schema.safeParse(raw);
}

export function parseManualStudyResults(raw: unknown) {
  return summitManualResultsSchema.safeParse(raw);
}

export type ValidationIssue = {
  path: string;
  message: string;
};

export function formatZodIssues(err: z.ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.join(".") || "(root)",
    message: i.message,
  }));
}

export type ValidationReport = {
  schemaOk: boolean;
  arithmeticOk: boolean;
  issues: ValidationIssue[];
  warnings: string[];
  stale?: boolean;
  staleReason?: string;
};

const TOL = 1;

export function validateSummitArithmetic(
  results: SummitResultsV1
): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  for (const scenario of results.scenarios) {
    for (let i = 0; i < scenario.timeline.length; i++) {
      const row = scenario.timeline[i]!;
      const prev = i > 0 ? scenario.timeline[i - 1]! : null;
      const expectedBeginning =
        i === 0
          ? results.opening_balance ?? row.beginning
          : prev!.ending;
      if (Math.abs(row.beginning - expectedBeginning) > TOL) {
        issues.push({
          path: `scenarios.${scenario.id}.timeline[${i}].beginning`,
          message: `Beginning ${row.beginning} should tie to ${expectedBeginning} (month ${row.month}).`,
        });
      }
      const expectedEnding = row.beginning + row.net;
      if (Math.abs(row.ending - expectedEnding) > TOL) {
        issues.push({
          path: `scenarios.${scenario.id}.timeline[${i}].ending`,
          message: `Ending ${row.ending} should equal beginning + net (${expectedEnding}) for ${row.month}.`,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function reconcileActualsCheck(
  checks: SummitResultsV1["actuals_check"],
  ledger: Array<{
    month: string;
    category: string;
    inflow: number;
    outflow: number;
    net: number;
  }>,
  tolerancePct = 0.02
): string[] {
  const warnings: string[] = [];
  const ledgerKey = (m: string, c: string) =>
    `${m.slice(0, 7)}|${c.toLowerCase()}`;

  const map = new Map<string, { inflow: number; outflow: number; net: number }>();
  for (const row of ledger) {
    const k = ledgerKey(row.month, row.category);
    const cur = map.get(k) ?? { inflow: 0, outflow: 0, net: 0 };
    cur.inflow += row.inflow;
    cur.outflow += row.outflow;
    cur.net += row.net;
    map.set(k, cur);
  }

  for (const check of checks) {
    const k = ledgerKey(check.month, check.category);
    const ours = map.get(k);
    if (!ours) {
      warnings.push(
        `No ledger aggregate for ${check.month.slice(0, 7)} · ${check.category}.`
      );
      continue;
    }
    const checkNet = check.net ?? check.inflow - check.outflow;
    const base = Math.max(Math.abs(ours.net), Math.abs(checkNet), 1);
    const diff = Math.abs(ours.net - checkNet) / base;
    if (diff > tolerancePct) {
      warnings.push(
        `${check.month.slice(0, 7)} · ${check.category}: submitted net ${Math.round(checkNet)} vs ledger ${Math.round(ours.net)} (${Math.round(diff * 100)}% off).`
      );
    }
  }
  return warnings;
}
