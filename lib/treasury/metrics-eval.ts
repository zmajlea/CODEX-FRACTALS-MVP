import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  collectMetricRefs,
  kindFromDefinition,
  type MetricBucketOp,
  type MetricChartHint,
  type MetricComparisonChartHint,
  type MetricDefinition,
  type MetricKind,
  type MetricReferenceLine,
  type MetricSource,
  type MetricSubdivision,
  type MetricWindow,
} from "@/lib/mcp/metrics-schema";
import {
  bucketEndDate,
  bucketLabel,
  bucketStartForDate,
  loadBucketedByCategoryFlat,
  nextBucketStart,
} from "@/lib/treasury/load-bucketed-by-category";
import { loadMonthlyByCategoryFlat } from "@/lib/treasury/load-monthly-by-category";

type Admin = SupabaseClient<Database>;

/** Internal month series for the legacy value path (YYYY-MM keys). */
type SeriesPoint = { month: string; value: number };

export type MetricSeriesPoint = {
  bucket_start: string;
  bucket_label: string;
  value: number;
  partial?: true;
  breaches?: string[];
};

export type MetricSeries = {
  v: 2;
  unit: string;
  subdivision: MetricSubdivision;
  window: { start: string; end: string };
  points: MetricSeriesPoint[];
  reference_lines: Array<{
    id: string;
    label: string;
    value: number;
    kind: MetricReferenceLine["kind"];
    computed: boolean;
  }>;
  summary?: { op: string; value: number; breach_count?: number };
  chart_hint: MetricChartHint;
};

export type MetricComparisonPoint = {
  bucket_label: string;
  value: number;
  partial?: true;
  breaches?: string[];
};

export type MetricComparison = {
  v: 3;
  kind: "comparison";
  unit: string;
  subdivision: MetricSubdivision;
  axis: { labels: string[] };
  groups: Array<{
    key: string;
    label: string;
    points: MetricComparisonPoint[];
  }>;
  reference_lines: Array<{
    id: string;
    label: string;
    value: number;
    kind: MetricReferenceLine["kind"];
    computed: boolean;
  }>;
  chart_hint: MetricComparisonChartHint;
  summary?: { op: string; value: number; breach_count?: number };
};

const MONTH_AXIS = [
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
] as const;
const QUARTER_AXIS = ["Q1", "Q2", "Q3", "Q4"] as const;

function isChartableKind(kind: MetricKind): boolean {
  return kind === "analytics" || kind === "comparison";
}

async function scalarFromDefinition(
  admin: Admin,
  tenantId: string,
  clientId: string,
  definition: MetricDefinition,
  depth: number
): Promise<number> {
  const kind = kindFromDefinition(definition);
  if (kind === "value") {
    return evalDefinitionScalar(admin, tenantId, clientId, definition, depth + 1);
  }
  if (kind === "analytics") {
    const series = await buildSeries(admin, tenantId, clientId, definition, depth + 1);
    return series.summary?.value ?? 0;
  }
  const comparison = await buildComparison(
    admin,
    tenantId,
    clientId,
    definition,
    depth + 1
  );
  return comparison.summary?.value ?? 0;
}

function resolveCompareYears(
  compare: NonNullable<MetricDefinition["compare"]>,
  now = new Date()
): number[] {
  if (compare.by !== "year") return [];
  if (compare.years?.length) {
    return [...compare.years].sort((a, b) => a - b);
  }
  const n = compare.last_n_years ?? 3;
  const y = now.getUTCFullYear();
  return Array.from({ length: n }, (_, i) => y - (n - 1 - i));
}

function monthBucketStart(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}

function quarterBucketStart(year: number, quarterIndex: number): string {
  const month = quarterIndex * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function isPartialBucket(bucketStart: string, subdivision: MetricSubdivision, now = new Date()): boolean {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const [by, bm] = bucketStart.split("-").map(Number);
  if (by !== y) return false;
  if (subdivision === "month") return bm === m + 1;
  if (subdivision === "quarter") return Math.floor(m / 3) + 1 === Math.floor((bm - 1) / 3) + 1;
  return false;
}

function finalizeComparison(
  definition: MetricDefinition,
  subdivision: MetricSubdivision,
  axisLabels: string[],
  groups: MetricComparison["groups"],
  chartHint: MetricComparisonChartHint
): MetricComparison {
  const flatValues = groups.flatMap((g) => g.points.map((p) => p.value));
  const resolvedLines: MetricComparison["reference_lines"] = [];

  for (const line of definition.reference_lines ?? []) {
    const computed = line.stat !== undefined;
    const value =
      line.value !== undefined ? line.value : computeStat(line.stat!, flatValues);
    resolvedLines.push({
      id: line.id,
      label: line.label,
      value,
      kind: line.kind,
      computed,
    });
  }

  let breachCount = 0;
  const annotatedGroups = groups.map((group) => ({
    ...group,
    points: group.points.map((p) => {
      const breaches: string[] = [];
      for (const line of definition.reference_lines ?? []) {
        const resolved = resolvedLines.find((r) => r.id === line.id)!;
        if (
          pointBreachesLine(p.value, {
            kind: line.kind,
            value: resolved.value,
            breach: line.breach,
          })
        ) {
          breaches.push(line.id);
        }
      }
      if (breaches.length) breachCount += 1;
      return breaches.length ? { ...p, breaches } : p;
    }),
  }));

  const summaryValue = flatValues.reduce((a, b) => a + b, 0);
  const summary =
    flatValues.length > 0
      ? {
          op: "sum",
          value: summaryValue,
          ...(breachCount ? { breach_count: breachCount } : {}),
        }
      : breachCount
        ? { op: "count", value: 0, breach_count: breachCount }
        : undefined;

  return {
    v: 3,
    kind: "comparison",
    unit: "amount",
    subdivision,
    axis: { labels: axisLabels },
    groups: annotatedGroups,
    reference_lines: resolvedLines,
    chart_hint: chartHint,
    ...(summary ? { summary } : {}),
  };
}

/** Build multi-series comparison envelope (Spec B14). */
export async function buildComparison(
  admin: Admin,
  tenantId: string,
  clientId: string,
  definition: MetricDefinition,
  depth = 0
): Promise<MetricComparison> {
  if (depth > 8) throw new Error("metric evaluation depth exceeded");
  if (!definition.compare) throw new Error("compare block required for series_compare");

  const subdivision: MetricSubdivision = definition.subdivision ?? "month";
  const bucketOp: MetricBucketOp = definition.bucket_op ?? "sum";
  const chartHint: MetricComparisonChartHint =
    definition.chart_hint === "multi_line" ? "multi_line" : "grouped_column";

  if (definition.compare.by === "year") {
    const years = resolveCompareYears(definition.compare);
    if (!years.length) throw new Error("compare years required");

    const axisLabels =
      subdivision === "quarter" ? [...QUARTER_AXIS] : [...MONTH_AXIS];
    const start = `${years[0]}-01-01`;
    const end = `${years[years.length - 1]}-12-31`;

    const rows = await loadBucketedByCategoryFlat(admin, clientId, {
      accountId: accountFilterFromSource(definition.source),
      from: start,
      to: end,
    });

    const raw = new Map<string, number[]>();
    for (const row of rows) {
      if (!matchSource(row, definition.source)) continue;
      const bucket = bucketStartForDate(row.posted_date, subdivision);
      const list = raw.get(bucket) ?? [];
      list.push(row.total);
      raw.set(bucket, list);
    }

    const groups: MetricComparison["groups"] = years.map((year) => {
      const points: MetricComparisonPoint[] = axisLabels.map((label, idx) => {
        const bucketStart =
          subdivision === "quarter"
            ? quarterBucketStart(year, idx)
            : monthBucketStart(year, idx);
        const value = applyBucketOp(bucketOp, raw.get(bucketStart) ?? []);
        const partial = isPartialBucket(bucketStart, subdivision) ? ({ partial: true as const }) : {};
        return { bucket_label: label, value, ...partial };
      });
      return { key: String(year), label: String(year), points };
    });

    return finalizeComparison(definition, subdivision, axisLabels, groups, chartHint);
  }

  const keys = definition.compare.keys ?? [];
  const bounds = calendarWindowBounds(definition.window);
  let axisLabels: string[] = [];
  const groups: MetricComparison["groups"] = [];

  for (const key of keys) {
    const source: MetricSource = {
      ...definition.source,
      type: "category",
      key,
    };
    const raw = new Map<string, number[]>();
    const rows = await loadBucketedByCategoryFlat(admin, clientId, {
      accountId: accountFilterFromSource(source),
      from: bounds.start,
      to: bounds.end,
    });
    for (const row of rows) {
      if (!matchSource(row, source)) continue;
      const bucket = bucketStartForDate(row.posted_date, subdivision);
      const list = raw.get(bucket) ?? [];
      list.push(row.total);
      raw.set(bucket, list);
    }
    const points = fillBuckets(raw, subdivision, bounds, bucketOp);
    if (!axisLabels.length) {
      axisLabels = points.map((p) => p.bucket_label);
    }
    groups.push({
      key,
      label: key,
      points: points.map((p) => ({
        bucket_label: p.bucket_label,
        value: p.value,
        ...(p.partial ? { partial: true as const } : {}),
      })),
    });
  }

  return finalizeComparison(definition, subdivision, axisLabels, groups, chartHint);
}

function accountFilterFromSource(source: MetricSource): string | null {
  if (source.type === "account" && source.key?.trim()) {
    return source.key.trim();
  }
  return null;
}

/** Legacy value-metric window filter — byte-identical to B3/B4. */
function filterWindow(points: SeriesPoint[], window: MetricWindow): SeriesPoint[] {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;

  if (window.kind === "all") return sorted;

  if (window.kind === "calendar_year") {
    const prefix = `${y}-`;
    return sorted.filter((p) => p.month.startsWith(prefix));
  }

  if (window.kind === "ytd") {
    const end = `${y}-${String(m).padStart(2, "0")}`;
    return sorted.filter((p) => p.month.startsWith(`${y}-`) && p.month <= end);
  }

  if (window.kind === "trailing") {
    const months = window.months ?? 3;
    const start = new Date(Date.UTC(y, m - (months - 1), 1));
    const startYm = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    const endYm = `${y}-${String(m + 1).padStart(2, "0")}`;
    return sorted.filter((p) => p.month >= startYm && p.month <= endYm);
  }

  const months = window.months ?? 3;
  return sorted.slice(-months);
}

function applyOp(
  op: NonNullable<MetricDefinition["op"]>,
  points: { value: number }[],
  of2?: number
): number {
  const vals = points.map((p) => p.value);
  if (op === "count") return vals.length;
  if (!vals.length) return 0;
  if (op === "sum") return vals.reduce((a, b) => a + b, 0);
  if (op === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (op === "min") return Math.min(...vals);
  if (op === "max") return Math.max(...vals);
  if (op === "stddev") {
    if (vals.length < 2) return 0;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const varSum = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1);
    return Math.sqrt(varSum);
  }
  if (op === "yoy") {
    if (vals.length < 2) return 0;
    const last = vals[vals.length - 1]!;
    const prev = vals[vals.length - 2]!;
    if (prev === 0) return 0;
    return ((last - prev) / Math.abs(prev)) * 100;
  }
  if (op === "pct_of") {
    const num = vals.reduce((a, b) => a + b, 0);
    const den = of2 ?? 0;
    if (den === 0) return 0;
    return (num / den) * 100;
  }
  return 0;
}

export function reduce(
  points: { value: number }[],
  op: NonNullable<MetricDefinition["op"]>,
  of2?: number
): number {
  return applyOp(op, points, of2);
}

function matchSource(
  row: { label: string; direction: "in" | "out"; total: number },
  source: MetricSource
): boolean {
  if (source.type === "metric") return false;
  const key = (source.key ?? "").toLowerCase();
  const label = row.label.toLowerCase();
  if (source.type === "category" || source.type === "bucket") {
    if (!key) return false;
    if (label !== key && !label.includes(key)) return false;
  }
  // account: account_id filter applied in the loader; here only direction
  const dir = source.direction ?? "any";
  if (dir !== "any" && row.direction !== dir) return false;
  return true;
}

async function seriesFromLedgerMonthly(
  admin: Admin,
  clientId: string,
  source: MetricSource
): Promise<SeriesPoint[]> {
  const rows = await loadMonthlyByCategoryFlat(admin, clientId, {
    accountId: accountFilterFromSource(source),
    from: "2000-01-01",
    to: "2099-12-31",
  });

  const byMonth = new Map<string, number>();
  for (const row of rows) {
    if (!matchSource(row, source)) continue;
    const month = row.month.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + row.total);
  }
  return [...byMonth.entries()]
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function calendarWindowBounds(window: MetricWindow, now = new Date()): {
  start: string;
  end: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  const end = new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);

  if (window.kind === "all") {
    return { start: "2000-01-01", end: "2099-12-31" };
  }
  if (window.kind === "calendar_year") {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (window.kind === "ytd") {
    return { start: `${y}-01-01`, end };
  }
  const months = window.months ?? 3;
  const start = new Date(Date.UTC(y, m - (months - 1), 1));
  return { start: start.toISOString().slice(0, 10), end };
}

function applyBucketOp(op: MetricBucketOp, values: number[]): number {
  if (op === "count") return values.length;
  if (!values.length) return 0;
  if (op === "sum") return values.reduce((a, b) => a + b, 0);
  if (op === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  if (op === "min") return Math.min(...values);
  if (op === "max") return Math.max(...values);
  return 0;
}

function computeStat(
  stat: NonNullable<MetricReferenceLine["stat"]>,
  values: number[]
): number {
  if (!values.length) return 0;
  if (stat === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  if (stat === "min") return Math.min(...values);
  if (stat === "max") return Math.max(...values);
  if (stat === "median") {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    return sorted[mid]!;
  }
  return 0;
}

function pointBreachesLine(
  pointValue: number,
  line: { kind: MetricReferenceLine["kind"]; value: number; breach?: string }
): boolean {
  if (line.breach !== "flag") return false;
  if (line.kind === "max" || line.kind === "threshold") return pointValue > line.value;
  if (line.kind === "min") return pointValue < line.value;
  return false;
}

function fillBuckets(
  raw: Map<string, number[]>,
  subdivision: MetricSubdivision,
  window: { start: string; end: string },
  bucketOp: MetricBucketOp
): MetricSeriesPoint[] {
  const firstRaw = [...raw.keys()].sort()[0];
  let cursor = bucketStartForDate(window.start, subdivision);
  // Align to first bucket that can overlap window
  if (firstRaw && firstRaw < cursor) {
    // still start at window-aligned bucket
  }
  const lastBucket = bucketStartForDate(window.end, subdivision);
  const points: MetricSeriesPoint[] = [];

  while (cursor <= lastBucket) {
    const vals = raw.get(cursor) ?? [];
    const value = applyBucketOp(bucketOp, vals);
    const bEnd = bucketEndDate(cursor, subdivision);
    const partial =
      cursor < window.start || bEnd > window.end ? true : undefined;
    points.push({
      bucket_start: cursor,
      bucket_label: bucketLabel(cursor, subdivision),
      value,
      ...(partial ? { partial: true as const } : {}),
    });
    cursor = nextBucketStart(cursor, subdivision);
  }
  return points;
}

type MetricRow = {
  id: string;
  name: string;
  definition: Json;
  client_user_id: string | null;
  tenant_id: string;
};

export async function detectMetricCycle(
  admin: Admin,
  tenantId: string,
  clientId: string | null,
  name: string,
  definition: MetricDefinition
): Promise<string | null> {
  const refs = [...collectMetricRefs(definition)];
  if (!refs.length) return null;

  const { data: peers } = await admin
    .from("treasury_metrics")
    .select("id, name, definition, client_user_id, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  const byName = new Map<string, MetricRow>();
  for (const m of peers ?? []) {
    if (m.client_user_id && clientId && m.client_user_id !== clientId) continue;
    if (m.client_user_id && !clientId) continue;
    byName.set(m.name, m as MetricRow);
  }

  const visiting = new Set<string>([name]);
  const stack: string[] = [...refs];

  while (stack.length) {
    const ref = stack.pop()!;
    if (visiting.has(ref)) {
      return `cycle detected involving metric "${ref}"`;
    }
    const peer = byName.get(ref);
    if (!peer) continue;
    visiting.add(ref);
    const def = peer.definition as unknown as MetricDefinition;
    for (const r of collectMetricRefs(def)) stack.push(r);
  }
  return null;
}

export async function resolveMetricRefs(
  admin: Admin,
  tenantId: string,
  clientId: string | null,
  definition: MetricDefinition
): Promise<string | null> {
  for (const ref of collectMetricRefs(definition)) {
    let q = admin
      .from("treasury_metrics")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("name", ref);
    if (clientId) {
      q = q.or(`client_user_id.eq.${clientId},client_user_id.is.null`);
    } else {
      q = q.is("client_user_id", null);
    }
    const { data } = await q.maybeSingle();
    if (!data) return `unresolved metric ref: ${ref}`;
  }
  return null;
}

/** Legacy scalar evaluation — value metrics only; B3/B4 byte-identical. */
async function evalDefinitionScalar(
  admin: Admin,
  tenantId: string,
  clientId: string,
  definition: MetricDefinition,
  depth = 0
): Promise<number> {
  if (depth > 8) throw new Error("metric evaluation depth exceeded");
  if (!definition.op) throw new Error("op required for value metrics");

  let points: SeriesPoint[];
  if (definition.source.type === "metric") {
    const ref = definition.source.ref!.trim();
    const { data: peer } = await admin
      .from("treasury_metrics")
      .select("definition")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("name", ref)
      .or(`client_user_id.eq.${clientId},client_user_id.is.null`)
      .maybeSingle();
    if (!peer) throw new Error(`unresolved metric ref: ${ref}`);
    const nested = peer.definition as unknown as MetricDefinition;
    const v = await evalDefinitionScalar(admin, tenantId, clientId, nested, depth + 1);
    points = [{ month: "ref", value: v }];
  } else {
    points = await seriesFromLedgerMonthly(admin, clientId, definition.source);
  }

  const windowed = filterWindow(points, definition.window);
  let of2: number | undefined;
  if (definition.of2) {
    of2 = await evalDefinitionScalar(
      admin,
      tenantId,
      clientId,
      definition.of2,
      depth + 1
    );
  }
  return applyOp(definition.op, windowed, of2);
}

/**
 * Build the chartable series envelope (analytics) or month→reduce inputs.
 * Reference lines + breaches live here; summary reduction is separate.
 */
export async function buildSeries(
  admin: Admin,
  tenantId: string,
  clientId: string,
  definition: MetricDefinition,
  depth = 0
): Promise<MetricSeries> {
  if (depth > 8) throw new Error("metric evaluation depth exceeded");

  const subdivision: MetricSubdivision = definition.subdivision ?? "month";
  const bucketOp: MetricBucketOp = definition.bucket_op ?? "sum";
  const bounds = calendarWindowBounds(definition.window);
  const chartHint: MetricChartHint =
    definition.chart_hint === "line" ? "line" : "column";

  // v1: metric refs / composition consume scalar summary only — one fake point.
  if (definition.source.type === "metric") {
    const ref = definition.source.ref!.trim();
    const { data: peer } = await admin
      .from("treasury_metrics")
      .select("definition, computed_value")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("name", ref)
      .or(`client_user_id.eq.${clientId},client_user_id.is.null`)
      .maybeSingle();
    if (!peer) throw new Error(`unresolved metric ref: ${ref}`);
    const nested = peer.definition as unknown as MetricDefinition;
    let scalar: number;
    if (isChartableKind(kindFromDefinition(nested))) {
      scalar = await scalarFromDefinition(admin, tenantId, clientId, nested, depth);
    } else {
      scalar = await evalDefinitionScalar(admin, tenantId, clientId, nested, depth + 1);
    }
    const points: MetricSeriesPoint[] = [
      {
        bucket_start: bounds.end,
        bucket_label: "ref",
        value: scalar,
      },
    ];
    return finalizeSeries(definition, subdivision, bounds, points, chartHint, admin, tenantId, clientId, depth);
  }

  const raw = new Map<string, number[]>();
  const rows = await loadBucketedByCategoryFlat(admin, clientId, {
    accountId: accountFilterFromSource(definition.source),
    from: bounds.start,
    to: bounds.end,
  });
  for (const row of rows) {
    if (!matchSource(row, definition.source)) continue;
    const key = bucketStartForDate(row.posted_date, subdivision);
    const list = raw.get(key) ?? [];
    list.push(row.total);
    raw.set(key, list);
  }

  const points = fillBuckets(raw, subdivision, bounds, bucketOp);
  return finalizeSeries(
    definition,
    subdivision,
    bounds,
    points,
    chartHint,
    admin,
    tenantId,
    clientId,
    depth
  );
}

async function finalizeSeries(
  definition: MetricDefinition,
  subdivision: MetricSubdivision,
  bounds: { start: string; end: string },
  points: MetricSeriesPoint[],
  chartHint: MetricChartHint,
  admin: Admin,
  tenantId: string,
  clientId: string,
  depth: number
): Promise<MetricSeries> {
  const values = points.map((p) => p.value);
  const resolvedLines: MetricSeries["reference_lines"] = [];

  for (const line of definition.reference_lines ?? []) {
    const computed = line.stat !== undefined;
    const value =
      line.value !== undefined
        ? line.value
        : computeStat(line.stat!, values);
    resolvedLines.push({
      id: line.id,
      label: line.label,
      value,
      kind: line.kind,
      computed,
    });
  }

  let breachCount = 0;
  const annotated = points.map((p) => {
    const breaches: string[] = [];
    for (const line of definition.reference_lines ?? []) {
      const resolved = resolvedLines.find((r) => r.id === line.id)!;
      if (
        pointBreachesLine(p.value, {
          kind: line.kind,
          value: resolved.value,
          breach: line.breach,
        })
      ) {
        breaches.push(line.id);
      }
    }
    if (breaches.length) breachCount += 1;
    return breaches.length
      ? { ...p, breaches }
      : p;
  });

  let summary: MetricSeries["summary"] | undefined;
  if (definition.op) {
    let of2: number | undefined;
    if (definition.of2) {
      of2 = await scalarFromDefinition(
        admin,
        tenantId,
        clientId,
        definition.of2,
        depth
      );
    }
    summary = {
      op: definition.op,
      value: reduce(annotated, definition.op, of2),
      ...(breachCount ? { breach_count: breachCount } : {}),
    };
  } else if (breachCount) {
    summary = { op: "count", value: annotated.length, breach_count: breachCount };
  }

  // Always surface breach_count when any breaches even if summary from op
  if (summary && breachCount && summary.breach_count === undefined) {
    summary.breach_count = breachCount;
  }
  if (!summary && breachCount) {
    summary = { op: "count", value: annotated.length, breach_count: breachCount };
  }

  return {
    v: 2,
    unit: definition.op === "pct_of" || definition.op === "yoy" ? "%" : "amount",
    subdivision,
    window: bounds,
    points: annotated,
    reference_lines: resolvedLines,
    ...(summary ? { summary } : {}),
    chart_hint: chartHint,
  };
}

export type ComputeMetricResult =
  | { kind: "value"; value: number; computed_at: string }
  | {
      kind: "analytics";
      series: MetricSeries;
      computed_at: string;
      value?: number;
    }
  | {
      kind: "comparison";
      comparison: MetricComparison;
      computed_at: string;
      value?: number;
    };

async function persistComputedValue(
  admin: Admin,
  metricId: string,
  computed_at: string,
  payload: Json
) {
  const { error } = await admin
    .from("treasury_metrics")
    .update({ computed_value: payload, computed_at })
    .eq("id", metricId);
  if (error) throw new Error(error.message);
}

export async function computeMetricValue(
  admin: Admin,
  metric: {
    id: string;
    tenant_id: string;
    client_user_id: string | null;
    definition: Json;
  }
): Promise<ComputeMetricResult> {
  if (!metric.client_user_id) {
    throw new Error("general metrics require a client_id to compute against a ledger");
  }
  const definition = metric.definition as unknown as MetricDefinition;
  const computed_at = new Date().toISOString();
  const kind = kindFromDefinition(definition);

  if (kind === "value") {
    const value = await evalDefinitionScalar(
      admin,
      metric.tenant_id,
      metric.client_user_id,
      definition
    );
    await persistComputedValue(admin, metric.id, computed_at, { value } as Json);
    return { kind: "value", value, computed_at };
  }

  if (kind === "comparison") {
    const comparison = await buildComparison(
      admin,
      metric.tenant_id,
      metric.client_user_id,
      definition
    );
    await persistComputedValue(
      admin,
      metric.id,
      computed_at,
      comparison as unknown as Json
    );
    return {
      kind: "comparison",
      comparison,
      computed_at,
      value: comparison.summary?.value,
    };
  }

  const series = await buildSeries(
    admin,
    metric.tenant_id,
    metric.client_user_id,
    definition
  );
  await persistComputedValue(admin, metric.id, computed_at, series as unknown as Json);
  return {
    kind: "analytics",
    series,
    computed_at,
    value: series.summary?.value,
  };
}

/**
 * Spec B4/B5 — validate + evaluate without persisting.
 * Value → { value }; analytics → { series }.
 */
export async function previewMetricValue(
  admin: Admin,
  tenantId: string,
  clientId: string,
  rawDefinition: unknown
): Promise<
  | { ok: true; kind: "value"; value: number }
  | { ok: true; kind: "analytics"; series: MetricSeries; value?: number }
  | { ok: true; kind: "comparison"; comparison: MetricComparison; value?: number }
  | { ok: false; errors: Array<{ path: string; message: string }> }
> {
  const { validateMetricDefinition } = await import("@/lib/mcp/metrics-schema");
  const validated = validateMetricDefinition(rawDefinition);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }

  const unresolved = await resolveMetricRefs(
    admin,
    tenantId,
    clientId,
    validated.definition
  );
  if (unresolved) {
    return {
      ok: false,
      errors: [{ path: "definition", message: unresolved }],
    };
  }

  try {
    const kind = kindFromDefinition(validated.definition);
    if (kind === "value") {
      const value = await evalDefinitionScalar(
        admin,
        tenantId,
        clientId,
        validated.definition
      );
      return { ok: true, kind: "value", value };
    }
    if (kind === "comparison") {
      const comparison = await buildComparison(
        admin,
        tenantId,
        clientId,
        validated.definition
      );
      return {
        ok: true,
        kind: "comparison",
        comparison,
        value: comparison.summary?.value,
      };
    }
    const series = await buildSeries(
      admin,
      tenantId,
      clientId,
      validated.definition
    );
    return {
      ok: true,
      kind: "analytics",
      series,
      value: series.summary?.value,
    };
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          path: "definition",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }
}

/** Load a metric owned by this tenant and visible on this client URL (client-or-null). */
export async function findMetricForClient(
  admin: Admin,
  tenantId: string,
  clientId: string,
  metricId: string
) {
  const { data, error } = await admin
    .from("treasury_metrics")
    .select("*")
    .eq("id", metricId)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .or(`client_user_id.eq.${clientId},client_user_id.is.null`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Recompute all active metrics visible on this client. */
export async function recalculateClientMetrics(
  admin: Admin,
  tenantId: string,
  clientId: string
): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const { data: metrics, error } = await admin
    .from("treasury_metrics")
    .select("id, tenant_id, client_user_id, definition")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .or(`client_user_id.eq.${clientId},client_user_id.is.null`);
  if (error) throw new Error(error.message);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const m of metrics ?? []) {
    const ledgerClientId = m.client_user_id ?? clientId;
    try {
      await computeMetricValue(admin, {
        id: m.id,
        tenant_id: m.tenant_id,
        client_user_id: ledgerClientId,
        definition: m.definition as Json,
      });
      results.push({ id: m.id, ok: true });
    } catch (e) {
      results.push({
        id: m.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
