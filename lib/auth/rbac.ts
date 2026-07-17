import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/database.types";
import {
  isCodexOneEmail,
  isOperatorRole,
  type CommercialTier,
} from "@/lib/auth/roles";

export type { CommercialTier } from "@/lib/auth/roles";
export {
  isCodexOneEmail,
  isOperatorRole,
  normalizeCommercialRole,
} from "@/lib/auth/roles";

export async function elevateGlobalAdmin(
  supabase: SupabaseClient<Database>
): Promise<boolean> {
  const { data, error } = await supabase.rpc("elevate_codexone_global_admin");
  if (error) {
    console.error("[rbac] elevate_codexone_global_admin failed:", error.message);
    return false;
  }
  return Boolean(data);
}

export async function getTier(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CommercialTier> {
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  const set = new Set((roles ?? []).map((r) => String(r.role)));
  if (set.has("global_admin")) return "global_admin";
  if (set.has("operator") || set.has("distributor")) return "operator";
  if (set.has("client")) return "client";
  return "none";
}

export async function requireTier(
  supabase: SupabaseClient<Database>,
  userId: string,
  allowed: CommercialTier[]
): Promise<CommercialTier> {
  const tier = await getTier(supabase, userId);
  if (!allowed.includes(tier)) {
    redirect("/login");
  }
  return tier;
}

export async function canSellModule(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  moduleSlug: string
): Promise<boolean> {
  const { data: mod } = await supabase
    .from("modules")
    .select("id")
    .eq("slug", moduleSlug)
    .maybeSingle();

  if (!mod) return false;

  const { data } = await supabase
    .from("operator_modules")
    .select("allowed")
    .eq("distributor_tenant_id", tenantId)
    .eq("module_id", mod.id)
    .maybeSingle();

  return Boolean(data?.allowed);
}

export async function canAccessModule(
  supabase: SupabaseClient<Database>,
  userId: string,
  moduleSlug: string,
  distributorTenantId?: string
): Promise<boolean> {
  const { data: mod } = await supabase
    .from("modules")
    .select("id")
    .eq("slug", moduleSlug)
    .maybeSingle();

  if (!mod) return false;

  let query = supabase
    .from("client_module_access")
    .select("id")
    .eq("client_user_id", userId)
    .eq("module_id", mod.id)
    .eq("status", "active");

  if (distributorTenantId) {
    query = query.eq("distributor_tenant_id", distributorTenantId);
  }

  const { data } = await query.maybeSingle();
  return Boolean(data);
}

export async function getPrimaryOperatorTenantId(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("user_roles")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const row = (data ?? []).find((r) => isOperatorRole(String(r.role)));
  return row?.tenant_id ?? null;
}

export type OperatorClientGrant = {
  tenantId: string;
  grantId: string | null;
};

/**
 * Single sanctioned entry for operator cross-client reads (service-role admin client).
 * Returns null when no active grant exists (suspended/revoked/absent).
 */
export async function operatorHasClientGrant(
  admin: SupabaseClient<Database>,
  operatorUserId: string,
  clientUserId: string,
  moduleSlug: string,
  opts?: { allowGlobalAdmin?: boolean }
): Promise<OperatorClientGrant | null> {
  const { data: mod } = await admin
    .from("modules")
    .select("id")
    .eq("slug", moduleSlug)
    .maybeSingle();

  if (!mod) return null;

  const { data: roles } = await admin
    .from("user_roles")
    .select("role, tenant_id")
    .eq("user_id", operatorUserId);

  const roleRows = roles ?? [];
  const isGlobalAdmin = roleRows.some((r) => r.role === "global_admin");

  if (opts?.allowGlobalAdmin && isGlobalAdmin) {
    const { data: activeGrants } = await admin
      .from("client_module_access")
      .select("id, distributor_tenant_id")
      .eq("client_user_id", clientUserId)
      .eq("module_id", mod.id)
      .eq("status", "active")
      .order("granted_at", { ascending: false })
      .limit(1);

    const activeGrant = activeGrants?.[0];
    if (!activeGrant) return null;

    return {
      tenantId: activeGrant.distributor_tenant_id,
      grantId: activeGrant.id,
    };
  }

  const operatorRow = roleRows.find((r) => isOperatorRole(String(r.role)));
  if (!operatorRow?.tenant_id) return null;

  const { data: grant } = await admin
    .from("client_module_access")
    .select("id, distributor_tenant_id")
    .eq("client_user_id", clientUserId)
    .eq("module_id", mod.id)
    .eq("distributor_tenant_id", operatorRow.tenant_id)
    .eq("status", "active")
    .maybeSingle();

  if (!grant) return null;

  return {
    tenantId: grant.distributor_tenant_id,
    grantId: grant.id,
  };
}

/** @deprecated use getPrimaryOperatorTenantId */
export const getPrimaryDistributorTenantId = getPrimaryOperatorTenantId;

export async function afterAuthBootstrap(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<void> {
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  await supabase.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      display_name: displayName,
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    },
    { onConflict: "id" }
  );

  if (isCodexOneEmail(user.email)) {
    await elevateGlobalAdmin(supabase);
  }
}

export async function resolveLoginPath(
  supabase: SupabaseClient<Database>
): Promise<string> {
  const { data, error } = await supabase.rpc("get_ff_login_route");
  if (error || !data || typeof data !== "object") {
    return "/login";
  }
  const route = (data as { route?: string }).route;
  return typeof route === "string" ? route : "/login";
}
