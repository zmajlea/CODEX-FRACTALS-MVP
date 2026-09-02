import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  collectMetricRefs,
  kindFromDefinition,
  type MetricBucketOp,
  type MetricChartHint,
  type MetricDefinition,
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

/** Optional account filter from metric source (B6). */
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
    definition.chart_hint ??
    (definition.source.direction === "any" || !definition.source.direction
      ? "column"
      : "column");

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
    // Scalar summary of nested (value path or nested analytics summary)
    let scalar: number;
    if (kindFromDefinition(nested) === "analytics") {
      const nestedSeries = await buildSeries(
        admin,
        tenantId,
        clientId,
        nested,
        depth + 1
      );
      scalar = nestedSeries.summary?.value ?? 0;
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
      // v1: of2 is scalar only
      if (kindFromDefinition(definition.of2) === "analytics") {
        const s = await buildSeries(
          admin,
          tenantId,
          clientId,
          definition.of2,
          depth + 1
        );
        of2 = s.summary?.value ?? 0;
      } else {
        of2 = await evalDefinitionScalar(
          admin,
          tenantId,
          clientId,
          definition.of2,
          depth + 1
        );
      }
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
    };

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
    const { error } = await admin
      .from("treasury_metrics")
      .update({
        computed_value: { value } as Json,
        computed_at,
      })
      .eq("id", metric.id);
    if (error) throw new Error(error.message);
    return { kind: "value", value, computed_at };
  }

  const series = await buildSeries(
    admin,
    metric.tenant_id,
    metric.client_user_id,
    definition
  );
  const { error } = await admin
    .from("treasury_metrics")
    .update({
      computed_value: series as unknown as Json,
      computed_at,
    })
    .eq("id", metric.id);
  if (error) throw new Error(error.message);
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
    if (kindFromDefinition(validated.definition) === "value") {
      const value = await evalDefinitionScalar(
        admin,
        tenantId,
        clientId,
        validated.definition
      );
      return { ok: true, kind: "value", value };
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
