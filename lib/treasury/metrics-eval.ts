import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  collectMetricRefs,
  type MetricDefinition,
  type MetricSource,
  type MetricWindow,
} from "@/lib/mcp/metrics-schema";
import { loadMonthlyByCategoryFlat } from "@/lib/treasury/load-monthly-by-category";

type Admin = SupabaseClient<Database>;

type SeriesPoint = { month: string; value: number };

async function primaryAccountId(admin: Admin, clientId: string) {
  const { data } = await admin
    .from("treasury_accounts")
    .select("id")
    .eq("client_user_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

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

  // trailing
  const months = window.months ?? 3;
  return sorted.slice(-months);
}

function applyOp(op: MetricDefinition["op"], points: SeriesPoint[], of2?: number): number {
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

function matchSource(
  row: { label: string; direction: "in" | "out"; total: number },
  source: MetricSource
): boolean {
  if (source.type === "metric") return false;
  const key = (source.key ?? "").toLowerCase();
  const label = row.label.toLowerCase();
  if (source.type === "category" || source.type === "bucket") {
    if (label !== key && !label.includes(key)) return false;
  }
  // account: key ignored for monthly_by_category (already account-scoped)
  const dir = source.direction ?? "any";
  if (dir !== "any" && row.direction !== dir) return false;
  return true;
}

async function seriesFromLedger(
  admin: Admin,
  clientId: string,
  source: MetricSource
): Promise<SeriesPoint[]> {
  const accountId = await primaryAccountId(admin, clientId);
  if (!accountId) return [];
  const rows = await loadMonthlyByCategoryFlat(admin, clientId, {
    accountId,
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

async function evalDefinition(
  admin: Admin,
  tenantId: string,
  clientId: string,
  definition: MetricDefinition,
  depth = 0
): Promise<number> {
  if (depth > 8) throw new Error("metric evaluation depth exceeded");

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
    // Treat nested metric as a single-point series for windowing ops
    const v = await evalDefinition(admin, tenantId, clientId, nested, depth + 1);
    points = [{ month: "ref", value: v }];
  } else {
    points = await seriesFromLedger(admin, clientId, definition.source);
  }

  const windowed = filterWindow(points, definition.window);
  let of2: number | undefined;
  if (definition.of2) {
    of2 = await evalDefinition(admin, tenantId, clientId, definition.of2, depth + 1);
  }
  return applyOp(definition.op, windowed, of2);
}

export async function computeMetricValue(
  admin: Admin,
  metric: {
    id: string;
    tenant_id: string;
    client_user_id: string | null;
    definition: Json;
  }
): Promise<{ value: number; computed_at: string }> {
  if (!metric.client_user_id) {
    throw new Error("general metrics require a client_id to compute against a ledger");
  }
  const definition = metric.definition as unknown as MetricDefinition;
  const value = await evalDefinition(
    admin,
    metric.tenant_id,
    metric.client_user_id,
    definition
  );
  const computed_at = new Date().toISOString();
  const { error } = await admin
    .from("treasury_metrics")
    .update({
      computed_value: { value } as Json,
      computed_at,
    })
    .eq("id", metric.id);
  if (error) throw new Error(error.message);
  return { value, computed_at };
}
