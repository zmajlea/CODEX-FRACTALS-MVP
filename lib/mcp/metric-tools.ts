import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { McpAuthContext } from "@/lib/mcp/types";
import { computeMetricValue } from "@/lib/treasury/metrics-eval";

type Admin = SupabaseClient<Database>;

export async function mcpListMetrics(
  admin: Admin,
  auth: McpAuthContext,
  clientId?: string
) {
  let q = admin
    .from("treasury_metrics")
    .select(
      "id, name, description, scope, source, status, computed_value, computed_at, client_user_id, created_at"
    )
    .eq("tenant_id", auth.tenantId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (clientId) {
    q = q.or(`client_user_id.eq.${clientId},client_user_id.is.null`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function mcpGetMetric(admin: Admin, auth: McpAuthContext, id: string) {
  const { data, error } = await admin
    .from("treasury_metrics")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Metric not found");
  return data;
}

export async function mcpComputeMetric(
  admin: Admin,
  auth: McpAuthContext,
  id: string,
  clientIdForGeneral?: string
) {
  const metric = await mcpGetMetric(admin, auth, id);
  const row = {
    id: metric.id,
    tenant_id: metric.tenant_id,
    client_user_id: metric.client_user_id ?? clientIdForGeneral ?? null,
    definition: metric.definition,
  };
  if (!row.client_user_id) {
    throw new Error("client_id required to compute a general metric");
  }
  // Temporarily bind client for general metrics
  const bound = { ...row, client_user_id: row.client_user_id };
  const out = await computeMetricValue(admin, bound);
  return {
    id: metric.id,
    name: metric.name,
    value: out.kind === "value" ? out.value : out.value,
    computed_at: out.computed_at,
    definition: metric.definition,
    ...(out.kind === "analytics" ? { series: out.series } : {}),
  };
}
