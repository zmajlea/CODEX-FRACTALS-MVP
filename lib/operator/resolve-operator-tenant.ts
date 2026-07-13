import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { getPrimaryOperatorTenantId, getTier } from "@/lib/auth/rbac";
import type { Database } from "@/lib/database.types";

export type OperatorTenantContext = {
  tenantId: string;
  tenantName: string;
  credits: number;
  domainSlug: string;
};

export async function resolveOperatorTenantContext(
  supabase: SupabaseClient<Database>,
  userId: string,
  tenantIdParam?: string | null
): Promise<OperatorTenantContext> {
  const tier = await getTier(supabase, userId);
  let tenantId = await getPrimaryOperatorTenantId(supabase, userId);

  if (!tenantId && tier === "global_admin" && tenantIdParam) {
    tenantId = tenantIdParam;
  }

  if (!tenantId) {
    if (tier === "global_admin") redirect("/admin");
    redirect(`${PORTAL_LOGIN}?next=/operator`);
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, domain_slug, credit_balance, available_credits")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) redirect(PORTAL_LOGIN);

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    domainSlug: tenant.domain_slug,
    credits: Number(tenant.credit_balance ?? tenant.available_credits ?? 0),
  };
}
