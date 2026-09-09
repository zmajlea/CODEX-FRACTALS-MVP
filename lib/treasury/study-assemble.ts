/**
 * Spec B16 — unified PlacedStudySnapshot for cash_model + external_model.
 * Spec B17 M2 — laid-out composite (exhibits/notes/kpi layout) + timeline back-compat.
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
import type { ReviewBlockLayout } from "@/lib/treasury/review-block-layout";
import { resolveLayout } from "@/lib/treasury/review-block-layout";
import type { ExternalModelDerivedSnapshot } from "@/lib/treasury/studies";
import {
  compositeFromDerivedSnapshot,
  type StudyCompositeExhibit,
} from "@/lib/treasury/study-page-composite";

export type PlacedStudyKpi = {
  id?: string;
  label: string;
  value: number | string;
  unit?: string;
  basis?: string;
  flag?: "none" | "warn";
  layout?: ReviewBlockLayout;
};

export type PlacedStudyTimelinePoint = {
  month: string;
  ending: number;
  projected?: boolean;
};

/** Analytics exhibit point — kept distinct from cash timeline. */
export type PlacedStudyAnalyticsPoint = {
  label: string;
  value: number;
};

export type PlacedStudyExhibitPoint =
  | PlacedStudyTimelinePoint
  | PlacedStudyAnalyticsPoint;

export type PlacedStudyTimeline = {
  points: PlacedStudyTimelinePoint[];
  reference_lines: Array<{ label: string; value: number; breach?: boolean }>;
  breach_month?: string | null;
  runway_months?: number | null;
  chart_hint: "line" | "column";
};

export type PlacedStudyExhibit = {
  id: string;
  title: string;
  chart_hint: "line" | "column";
  series_kind?: "cash" | "analytics";
  points: PlacedStudyExhibitPoint[];
  reference_lines: Array<{ label: string; value: number; breach?: boolean }>;
  layout: ReviewBlockLayout;
  breach_month?: string | null;
  runway_months?: number | null;
};

export type PlacedStudyNote = {
  id: string;
  body: string;
  layout: ReviewBlockLayout;
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
  /** Back-compat alias of exhibits[0] timeline fields. */
  timeline: PlacedStudyTimeline | null;
  exhibits?: PlacedStudyExhibit[];
  notes?: PlacedStudyNote[];
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
  /**
   * Spec B21 — placed-block chrome that survives client scrub.
   * Optional so cash_model / external / old freezes stay valid.
   */
  assumptions?: string[];
  method_note?: string;
  confidence?: {
    grade: "solid" | "indicative" | "thin" | "refused";
    note?: string;
  };
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
  for (const e of cleaned.exhibits ?? []) {
    if (scanEnvelope(e.title).length) e.title = "[redacted]";
  }
  for (const n of cleaned.notes ?? []) {
    if (scanEnvelope(n.body).length) n.body = "[redacted]";
  }
  // Spec B21 — chrome text must scrub; grade is an enum (never redact).
  // Keep the assumptions array shape: redact strings in place, don't drop the array.
  if (Array.isArray(cleaned.assumptions)) {
    cleaned.assumptions = cleaned.assumptions.map((a) =>
      typeof a === "string" && scanEnvelope(a).length ? "[redacted]" : a
    );
  }
  if (
    typeof cleaned.method_note === "string" &&
    scanEnvelope(cleaned.method_note).length
  ) {
    cleaned.method_note = "[redacted]";
  }
  if (cleaned.confidence && typeof cleaned.confidence.note === "string") {
    if (scanEnvelope(cleaned.confidence.note).length) {
      cleaned.confidence = {
        grade: cleaned.confidence.grade,
        note: "[redacted]",
      };
    }
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

/**
 * Ensure exhibits[] exists (synthesize from timeline for B16 snaps) and
 * timeline stays exhibits[0] alias.
 */
export function normalizePlacedStudy(snap: PlacedStudySnapshot): PlacedStudySnapshot {
  const next: PlacedStudySnapshot = {
    ...snap,
    assumptions: snap.assumptions ?? [],
    kpis: snap.kpis.map((k, i) => ({
      ...k,
      id: k.id ?? `kpi-${i}`,
      layout: resolveLayout(k.layout ?? { w: 3, h: 1 }),
    })),
    notes: (snap.notes ?? []).map((n) => ({
      ...n,
      layout: resolveLayout(n.layout),
    })),
  };

  let exhibits = snap.exhibits ?? [];
  if (!exhibits.length && snap.timeline?.points?.length) {
    exhibits = [
      {
        id: "timeline-0",
        title: "Timeline",
        chart_hint: snap.timeline.chart_hint === "column" ? "column" : "line",
        points: snap.timeline.points,
        reference_lines: snap.timeline.reference_lines ?? [],
        layout: { w: 12, h: 2 },
        breach_month: snap.timeline.breach_month,
        runway_months: snap.timeline.runway_months,
      },
    ];
  }
  next.exhibits = exhibits.map((e) => ({
    ...e,
    layout: resolveLayout(e.layout ?? { w: 12, h: 2 }),
  }));

  const first = next.exhibits[0];
  if (first) {
    next.timeline = {
      points: first.points.filter(isCashPoint),
      reference_lines: first.reference_lines,
      breach_month: first.breach_month ?? null,
      runway_months: first.runway_months ?? null,
      chart_hint: first.chart_hint === "column" ? "column" : "line",
    };
  } else if (!next.timeline) {
    next.timeline = null;
  }

  return next;
}

function isCashPoint(
  p: PlacedStudyExhibitPoint
): p is PlacedStudyTimelinePoint {
  return "month" in p && "ending" in p;
}

function exhibitFromComposite(e: StudyCompositeExhibit): PlacedStudyExhibit {
  return {
    id: e.id,
    title: e.title,
    chart_hint: e.chart_hint,
    series_kind: e.series_kind ?? "cash",
    points: e.points,
    reference_lines: e.reference_lines,
    layout: resolveLayout(e.layout),
  };
}

function timelineFromExhibit(e: PlacedStudyExhibit): PlacedStudyTimeline {
  const cashPoints = e.points.filter(isCashPoint);
  return {
    points: cashPoints,
    reference_lines: e.reference_lines,
    breach_month: e.breach_month ?? null,
    runway_months: e.runway_months ?? null,
    chart_hint: e.chart_hint === "column" ? "column" : "line",
  };
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

/** Map summit.results/v1 (+ optional composite sibling) → PlacedStudySnapshot. */
export function placedStudyFromExternal(study: {
  id: string;
  name: string;
  derived_snapshot: unknown;
}): PlacedStudySnapshot {
  const derived = study.derived_snapshot;
  const results = (isExternalDerived(derived) ? derived.results : {}) as Partial<SummitResultsV1>;
  const composite = compositeFromDerivedSnapshot(derived);
  const asOf = String(results.as_of ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

  const kpis: PlacedStudyKpi[] = (results.kpis ?? []).map((k, i) => {
    const layoutEntry = composite?.kpiLayouts[i] ?? composite?.kpiLayouts.find(
      (l) => l.id === `kpi-${i}`
    );
    return {
      id: layoutEntry?.id ?? `kpi-${i}`,
      label: String(k.label),
      value: k.value as number | string,
      unit: k.unit,
      flag: "none" as const,
      layout: resolveLayout(layoutEntry?.layout ?? { w: 3, h: 1 }),
    };
  });

  const scenariosRaw = results.scenarios ?? [];
  let exhibits: PlacedStudyExhibit[] = [];

  if (composite?.exhibits?.length) {
    exhibits = composite.exhibits.map(exhibitFromComposite);
  } else {
    // B16 path: scenarios → exhibits
    for (let i = 0; i < scenariosRaw.length; i++) {
      const s = scenariosRaw[i]!;
      if (!s.timeline?.length) continue;
      exhibits.push({
        id: s.id || `scenario-${i}`,
        title: s.name || `Scenario ${i + 1}`,
        chart_hint: "line",
        series_kind: "cash",
        points: s.timeline.map((row) => ({
          month: row.month.slice(0, 7),
          ending: row.ending,
        })),
        reference_lines: [],
        layout: { w: 12, h: 2 },
        breach_month: s.breach_month ?? null,
        runway_months: s.runway_months ?? null,
      });
    }
  }

  const timeline = exhibits[0] ? timelineFromExhibit(exhibits[0]) : null;

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

  const notes =
    composite?.notes?.map((n) => ({
      id: n.id,
      body: n.body,
      layout: resolveLayout(n.layout),
    })) ?? [];

  const narrative =
    notes.length > 0
      ? notes.map((n) => ({ target: "note", text: n.body }))
      : (results.narrative ?? []).map((n) => ({
          target: n.heading?.trim() || "note",
          text: n.body,
        }));

  const recommendations = (results.recommendations ?? []).map((r) => ({
    category: r.category ?? "liquidity",
    title: r.title,
    body: r.body,
  }));

  return scrubPlacedStudySnapshot(
    normalizePlacedStudy({
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
      exhibits,
      notes,
      scenarios,
      narrative,
      recommendations,
    })
  );
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

  const exhibits: PlacedStudyExhibit[] = [
    {
      id: "timeline-0",
      title: "Ending cash",
      chart_hint: "line",
      series_kind: "cash",
      points: timeline.points,
      reference_lines: timeline.reference_lines,
      layout: { w: 12, h: 2 },
      breach_month: timeline.breach_month,
      runway_months: timeline.runway_months,
    },
  ];

  return scrubPlacedStudySnapshot(
    normalizePlacedStudy({
      kind: "study",
      study_id: input.studyId,
      name: input.name,
      type: "cash_model",
      as_of: input.asOf,
      opening_balance: input.openingBalanceRaw,
      opening_balance_source: input.openingBalanceSource,
      kpis: kpis.map((k, i) => ({
        ...k,
        id: `kpi-${i}`,
        layout: { w: 3, h: 1 },
      })),
      timeline,
      exhibits,
      notes: [],
      scenarios: null,
      narrative: [],
      recommendations: [],
    })
  );
}

export function isStudyPlaceable(study: {
  type: string;
  status?: string | null;
  derived_snapshot?: unknown;
}): boolean {
  // Must match MODEL_KINDS.*.placeable (keep dual honest — gate asserts agreement).
  if (study.type === "cash_model") return true;
  if (study.type === "external_model") {
    return study.status === "confirmed";
  }
  if (study.type === "forecast" || study.type === "seasonality") {
    if (study.status === "pending" || study.status === "discarded") return false;
    const derived = study.derived_snapshot;
    if (derived && typeof derived === "object") {
      const grade = (derived as { confidence?: { grade?: string } }).confidence
        ?.grade;
      if (grade === "refused") return false;
    }
    return true;
  }
  return false;
}

export function studyAsOfFromRow(studyRow: Record<string, unknown>): string {
  // Must match MODEL_KINDS.*.asOf for registered kinds.
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
  if (type === "forecast" || type === "seasonality") {
    const d = studyRow.derived_snapshot as { asOf?: string } | null;
    return String(d?.asOf ?? "").slice(0, 10);
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
