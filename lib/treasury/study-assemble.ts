/**
 * Spec B16 — unified PlacedStudySnapshot for cash_model + external_model.
 * Pure module (no server-only imports) — safe for client renderers.
 */

import type { Json } from "@/lib/database.types";
import type { SummitResultsV1 } from "@/lib/mcp/results-schema";
import type {
  CashModelDerivedSnapshot,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import { scanEnvelope } from "@/lib/treasury/envelope-scan";
import type { ExternalModelDerivedSnapshot } from "@/lib/treasury/studies";

export type PlacedStudyKpi = {
  label: string;
  value: number | string;
  unit?: string;
  basis?: string;
  flag?: "none" | "warn";
};

export type PlacedStudyTimelinePoint = {
  month: string;
  ending: number;
  projected?: boolean;
};

export type PlacedStudyTimeline = {
  points: PlacedStudyTimelinePoint[];
  reference_lines: Array<{ label: string; value: number; breach?: boolean }>;
  breach_month?: string | null;
  runway_months?: number | null;
  chart_hint: "line";
};

export type PlacedStudySnapshot = {
  kind: "study";
  study_id: string;
  name: string;
  type: "cash_model" | "external_model" | string;
  as_of: string;
  opening_balance?: number | null;
  opening_balance_source?: "ledger" | "manual" | "unknown" | null;
  kpis: PlacedStudyKpi[];
  timeline: PlacedStudyTimeline | null;
  scenarios: Array<{ id: string; label: string; timeline: PlacedStudyTimeline }> | null;
  narrative: Array<{ target: string; text: string }>;
  recommendations: Array<{
    category: string;
    title: string;
    body: string;
    impact_amount?: number;
    unit?: string;
    basis?: string;
  }>;
};

const ACCOUNT_KEYS = new Set([
  "account_id",
  "accountId",
  "account",
  "plaid_account_id",
  "internal_name",
  "internalName",
  "bucketMap",
  "bucket_map",
]);

/** Deep-scrub account ids / internal keys from a placed study snapshot. */
export function scrubPlacedStudySnapshot(
  snap: PlacedStudySnapshot
): PlacedStudySnapshot {
  const cleaned = JSON.parse(JSON.stringify(snap)) as PlacedStudySnapshot;
  stripAccountKeys(cleaned as unknown as Record<string, unknown>);
  for (const n of cleaned.narrative) {
    if (scanEnvelope(n.text).length) n.text = "[redacted]";
    if (scanEnvelope(n.target).length) n.target = "note";
  }
  for (const r of cleaned.recommendations) {
    if (scanEnvelope(r.title).length) r.title = "[redacted]";
    if (scanEnvelope(r.body).length) r.body = "[redacted]";
  }
  return cleaned;
}

function stripAccountKeys(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) stripAccountKeys(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (ACCOUNT_KEYS.has(key)) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (typeof val === "string" && looksLikeUuid(val) && /account/i.test(key)) {
      delete obj[key];
      continue;
    }
    stripAccountKeys(val);
  }
}

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

export function isPlacedStudySnapshot(value: unknown): value is PlacedStudySnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as PlacedStudySnapshot;
  return (
    v.kind === "study" &&
    typeof v.study_id === "string" &&
    typeof v.name === "string" &&
    Array.isArray(v.kpis)
  );
}

function isExternalDerived(
  value: unknown
): value is ExternalModelDerivedSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    "results" in (value as object) &&
    "submittedAt" in (value as object)
  );
}

/** Map summit.results/v1 → PlacedStudySnapshot (manual / MCP). */
export function placedStudyFromExternal(study: {
  id: string;
  name: string;
  derived_snapshot: unknown;
}): PlacedStudySnapshot {
  const derived = study.derived_snapshot;
  const results = (isExternalDerived(derived) ? derived.results : {}) as Partial<SummitResultsV1>;
  const asOf = String(results.as_of ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

  const kpis: PlacedStudyKpi[] = (results.kpis ?? []).map((k) => ({
    label: String(k.label),
    value: k.value as number | string,
    unit: k.unit,
    flag: "none" as const,
  }));

  const scenariosRaw = results.scenarios ?? [];
  const primary = scenariosRaw[0];
  let timeline: PlacedStudyTimeline | null = null;
  if (primary?.timeline?.length) {
    timeline = {
      points: primary.timeline.map((row) => ({
        month: row.month.slice(0, 7),
        ending: row.ending,
      })),
      reference_lines: [],
      breach_month: primary.breach_month ?? null,
      runway_months: primary.runway_months ?? null,
      chart_hint: "line",
    };
  }

  const scenarios =
    scenariosRaw.length > 1
      ? scenariosRaw.map((s) => ({
          id: s.id,
          label: s.name,
          timeline: {
            points: s.timeline.map((row) => ({
              month: row.month.slice(0, 7),
              ending: row.ending,
            })),
            reference_lines: [] as PlacedStudyTimeline["reference_lines"],
            breach_month: s.breach_month ?? null,
            runway_months: s.runway_months ?? null,
            chart_hint: "line" as const,
          },
        }))
      : null;

  const narrative = (results.narrative ?? []).map((n) => ({
    target: n.heading?.trim() || "note",
    text: n.body,
  }));

  const recommendations = (results.recommendations ?? []).map((r) => ({
    category: r.category ?? "liquidity",
    title: r.title,
    body: r.body,
  }));

  return scrubPlacedStudySnapshot({
    kind: "study",
    study_id: study.id,
    name: study.name || results.headline || "Study",
    type: "external_model",
    as_of: asOf,
    opening_balance:
      typeof results.opening_balance === "number" ? results.opening_balance : null,
    opening_balance_source:
      typeof results.opening_balance === "number" ? "manual" : null,
    kpis,
    timeline,
    scenarios,
    narrative,
    recommendations,
  });
}

/** Map cash_model compute output → PlacedStudySnapshot. */
export function placedStudyFromCashModelCompute(input: {
  studyId: string;
  name: string;
  asOf: string;
  openingBalanceRaw: number | null;
  openingBalanceSource: "ledger" | "manual" | "unknown";
  timeline: Array<{
    month: string;
    ending: number;
    kind: "actual" | "projected";
    breachFlag?: boolean;
  }>;
  summaries: Array<{
    scenarioId: string;
    scenarioName: string;
    runwayMonths: number | null;
    breachMonth: string | null;
    minEnding: { month: string; value: number };
  }>;
  params: CashModelParams;
  scenarios: CashModelScenario[];
  derived: CashModelDerivedSnapshot;
}): PlacedStudySnapshot {
  const selectedId = input.params.selectedScenarioId ?? input.scenarios[0]?.id;
  const selected =
    input.summaries.find((s) => s.scenarioId === selectedId) ?? input.summaries[0];
  const threshold =
    input.scenarios.find((s) => s.id === selectedId)?.minCashThreshold ??
    input.scenarios[0]?.minCashThreshold ??
    null;

  const kpis: PlacedStudyKpi[] = [
    {
      label: "Opening balance",
      value: input.openingBalanceRaw ?? 0,
      unit: "usd",
      basis: input.openingBalanceSource,
      flag: input.openingBalanceRaw == null ? "warn" : "none",
    },
    {
      label: "Runway",
      value: selected?.runwayMonths ?? "—",
      unit: selected?.runwayMonths != null ? "months" : undefined,
      flag: selected?.breachMonth ? "warn" : "none",
    },
    {
      label: "Breach month",
      value: selected?.breachMonth ?? "None in horizon",
      flag: selected?.breachMonth ? "warn" : "none",
    },
  ];
  if (input.derived.runwayStatus?.label) {
    kpis.push({
      label: "Status",
      value: input.derived.runwayStatus.label,
      flag: input.derived.runwayStatus.level === "green" ? "none" : "warn",
    });
  }

  const timeline: PlacedStudyTimeline = {
    points: input.timeline.map((row) => ({
      month: row.month.slice(0, 7),
      ending: row.ending,
      projected: row.kind === "projected",
    })),
    reference_lines:
      threshold != null
        ? [{ label: "Min cash", value: threshold, breach: true }]
        : [],
    breach_month: selected?.breachMonth ?? null,
    runway_months: selected?.runwayMonths ?? null,
    chart_hint: "line",
  };

  return scrubPlacedStudySnapshot({
    kind: "study",
    study_id: input.studyId,
    name: input.name,
    type: "cash_model",
    as_of: input.asOf,
    opening_balance: input.openingBalanceRaw,
    opening_balance_source: input.openingBalanceSource,
    kpis,
    timeline,
    scenarios: null,
    narrative: [],
    recommendations: [],
  });
}

export function isStudyPlaceable(study: {
  type: string;
  status?: string | null;
}): boolean {
  if (study.type === "cash_model") return true;
  if (study.type === "external_model") {
    return study.status === "confirmed";
  }
  return false;
}

export function studyAsOfFromRow(studyRow: Record<string, unknown>): string {
  const type = String(studyRow.type ?? "");
  if (type === "cash_model") {
    const d = studyRow.derived_snapshot as CashModelDerivedSnapshot | null;
    return String(d?.asOf ?? "").slice(0, 10);
  }
  if (type === "external_model") {
    const d = studyRow.derived_snapshot as ExternalModelDerivedSnapshot | null;
    const results = d?.results as { as_of?: string } | undefined;
    return String(results?.as_of ?? d?.submittedAt ?? "").slice(0, 10);
  }
  return "";
}

export function placedStudyToJson(snap: PlacedStudySnapshot): Json {
  return scrubPlacedStudySnapshot(snap) as unknown as Json;
}

/** Compare placed vs fresh for staleness (as_of + KPI values). */
export function studySnapshotDiffers(
  placed: unknown,
  fresh: PlacedStudySnapshot
): boolean {
  if (!isPlacedStudySnapshot(placed)) return true;
  if (placed.as_of !== fresh.as_of) return true;
  if (placed.kpis.length !== fresh.kpis.length) return true;
  for (let i = 0; i < fresh.kpis.length; i++) {
    if (
      String(placed.kpis[i]?.value) !== String(fresh.kpis[i]?.value) ||
      placed.kpis[i]?.label !== fresh.kpis[i]?.label
    ) {
      return true;
    }
  }
  const pt = placed.timeline?.points?.length ?? 0;
  const ft = fresh.timeline?.points?.length ?? 0;
  if (pt !== ft) return true;
  if (pt > 0 && ft > 0) {
    const lastP = placed.timeline!.points[pt - 1]!;
    const lastF = fresh.timeline!.points[ft - 1]!;
    if (lastP.ending !== lastF.ending || lastP.month !== lastF.month) return true;
  }
  return false;
}

/** Assert scrub removed account identifiers from a snapshot JSON string. */
export function placedStudyHasAccountLeak(snap: PlacedStudySnapshot): boolean {
  const raw = JSON.stringify(snap);
  if (/"accountId"\s*:/.test(raw) || /"account_id"\s*:/.test(raw)) return true;
  if (/"bucketMap"\s*:/.test(raw)) return true;
  return false;
}
