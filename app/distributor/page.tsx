import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getPrimaryDistributorTenantId } from "@/lib/auth/rbac";
import { DistributorDashboard } from "@/components/platform/DistributorDashboard";

export default async function DistributorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/distributor");

  const tenantId = await getPrimaryDistributorTenantId(supabase, user.id);

  if (!tenantId) redirect("/login");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, domain_slug, credit_balance, available_credits")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) redirect("/login");

  return (
    <DistributorDashboard
      tenantId={tenant.id}
      domainSlug={tenant.domain_slug}
      tenantName={tenant.name}
      credits={Number(tenant.credit_balance ?? tenant.available_credits ?? 0)}
    />
  );
}
