import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { requireTier } from "@/lib/auth/rbac";
import { GlobalAdminPanel } from "@/components/platform/GlobalAdminPanel";
import { OperatorModuleToggles } from "@/components/platform/OperatorModuleToggles";
import {
  OperatorRegistryTable,
  type DistributorFirmRow,
} from "@/components/platform/OperatorRegistryTable";
import "@/app/ff/ff-v1.css";

export default async function GlobalAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${PORTAL_LOGIN}?next=/admin`);

  await requireTier(supabase, user.id, ["global_admin"]);

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, domain_slug, credit_balance, brand_color_hex")
    .order("name");

  const { data: billingRules } = await supabase
    .from("billing_rules")
    .select("id, scope, payer, credit_cost")
    .eq("active", true);

  const { data: modules } = await supabase
    .from("modules")
    .select("id, slug, name, status")
    .in("status", ["active", "beta"])
    .order("name");

  const { data: entitlementRows } = await supabase
    .from("operator_modules")
    .select("distributor_tenant_id, allowed, modules(slug)");

  const entitlements = (entitlementRows ?? []).map((row) => ({
    tenant_id: row.distributor_tenant_id,
    module_slug: (row.modules as { slug: string } | null)?.slug ?? "",
    allowed: row.allowed,
  }));

  const { data: directoryData } = await supabase.rpc("list_distributor_staff_directory");
  const firms = (Array.isArray(directoryData) ? directoryData : []) as DistributorFirmRow[];

  const tenantList = (tenants ?? []).map((t) => ({
    ...t,
    credit_balance: Number(t.credit_balance ?? 0),
  }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-head text-3xl text-obsidian mb-8">Platform registry</h1>
      <GlobalAdminPanel tenants={tenantList} billingRules={billingRules ?? []} />
      <div className="mt-8">
        <OperatorRegistryTable firms={firms} />
      </div>
      <div className="mt-8">
        <OperatorModuleToggles
          tenants={tenantList}
          modules={modules ?? []}
          entitlements={entitlements}
        />
      </div>
    </div>
  );
}
