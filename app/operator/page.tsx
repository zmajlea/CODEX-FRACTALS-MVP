import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { getPrimaryOperatorTenantId, getTier } from "@/lib/auth/rbac";
import { OperatorDashboard } from "@/components/platform/OperatorDashboard";

export default async function OperatorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${PORTAL_LOGIN}?next=/operator`);

  const tenantId = await getPrimaryOperatorTenantId(supabase, user.id);

  if (!tenantId) {
    const tier = await getTier(supabase, user.id);
    if (tier === "global_admin") redirect("/admin");
    redirect(`${PORTAL_LOGIN}?next=/operator`);
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, domain_slug, credit_balance, available_credits")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) redirect(PORTAL_LOGIN);

  return (
    <OperatorDashboard
      tenantId={tenant.id}
      domainSlug={tenant.domain_slug}
      tenantName={tenant.name}
      credits={Number(tenant.credit_balance ?? tenant.available_credits ?? 0)}
    />
  );
}
