/**
 * B23 — upsert the client's single primary cash_model in place.
 * Shared by POST /studies and gate so they cannot drift.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

export type UpsertPrimaryCashModelArgs = {
  clientUserId: string;
  tenantId: string;
  actorUserId: string;
  name: string;
  scope: { accountId: string; label?: string | null };
  params: unknown;
  scenarios: unknown;
  derived_snapshot: unknown;
};

export type UpsertPrimaryCashModelResult =
  | { ok: true; row: Record<string, unknown>; created: boolean }
  | { ok: false; error: string };

/**
 * If a primary cash_model exists for the client, UPDATE it (same id).
 * Else INSERT one with is_primary=true. Never demotes.
 */
export async function upsertPrimaryCashModel(
  admin: Admin,
  args: UpsertPrimaryCashModelArgs
): Promise<UpsertPrimaryCashModelResult> {
  const scopeJson = {
    accountId: args.scope.accountId,
    label: args.scope.label ?? null,
  } as unknown as Json;

  const { data: existing, error: findErr } = await admin
    .from("treasury_studies")
    .select("id")
    .eq("client_user_id", args.clientUserId)
    .eq("type", "cash_model")
    .eq("is_primary", true)
    .maybeSingle();

  if (findErr) {
    return { ok: false, error: findErr.message };
  }

  if (existing?.id) {
    const { data, error } = await admin
      .from("treasury_studies")
      .update({
        name: args.name,
        scope: scopeJson,
        params: args.params as Json,
        scenarios: args.scenarios as Json,
        derived_snapshot: args.derived_snapshot as Json,
        status: "confirmed",
        source: "operator",
        is_primary: true,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? "Update failed" };
    }
    return { ok: true, row: data as Record<string, unknown>, created: false };
  }

  const insert: Database["public"]["Tables"]["treasury_studies"]["Insert"] = {
    client_user_id: args.clientUserId,
    operator_tenant_id: args.tenantId,
    created_by: args.actorUserId,
    name: args.name,
    type: "cash_model",
    status: "confirmed",
    source: "operator",
    is_primary: true,
    scope: scopeJson,
    params: args.params as Json,
    scenarios: args.scenarios as Json,
    derived_snapshot: args.derived_snapshot as Json,
  };

  const { data, error } = await admin
    .from("treasury_studies")
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  return { ok: true, row: data as Record<string, unknown>, created: true };
}
