import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { validateMetricDefinition } from "@/lib/mcp/metrics-schema";
import {
  detectMetricCycle,
  resolveMetricRefs,
} from "@/lib/treasury/metrics-eval";

type Admin = SupabaseClient<Database>;

export type CreateMetricInput = {
  tenantId: string;
  operatorUserId: string;
  scope: "general" | "client";
  clientId: string | null;
  name: string;
  description: string;
  definition: unknown;
  source: "mcp" | "platform";
};

/**
 * Spec B4 Part A — single validated create path for MCP + platform UI.
 * Throws with a clear message on invalid definition / refs / cycles.
 */
export async function createMetric(admin: Admin, input: CreateMetricInput) {
  const name = input.name.trim();
  if (!name) throw new Error("name required");
  if (input.scope === "client" && !input.clientId) {
    throw new Error("client_id required for scope=client");
  }
  if (input.scope === "general" && input.clientId) {
    throw new Error("client_id must be omitted for scope=general");
  }

  const validated = validateMetricDefinition(input.definition);
  if (!validated.ok) {
    const err = new Error(
      `Invalid definition: ${validated.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
    ) as Error & { fieldErrors?: Array<{ path: string; message: string }> };
    err.fieldErrors = validated.errors;
    throw err;
  }

  const clientId = input.clientId ?? null;
  const unresolved = await resolveMetricRefs(
    admin,
    input.tenantId,
    clientId,
    validated.definition
  );
  if (unresolved) throw new Error(unresolved);

  const cycle = await detectMetricCycle(
    admin,
    input.tenantId,
    clientId,
    name,
    validated.definition
  );
  if (cycle) throw new Error(cycle);

  const { data, error } = await admin
    .from("treasury_metrics")
    .insert({
      tenant_id: input.tenantId,
      client_user_id: clientId,
      scope: input.scope,
      name,
      description: input.description.trim(),
      definition: validated.definition as unknown as Json,
      source: input.source,
      status: "active",
      created_by: input.operatorUserId,
    })
    .select("id, name, scope, status, source")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
