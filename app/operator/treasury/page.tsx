import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { resolveBilling } from "@/lib/billing/resolve-billing";
import {
  OperatorTreasuryPortfolio,
  type OperatorTreasuryClientRow,
} from "@/components/operator/OperatorTreasuryPortfolio";
import { resolveOperatorTenantContext } from "@/lib/operator/resolve-operator-tenant";

type Props = {
  searchParams: Promise<{ tenantId?: string }>;
};

export default async function OperatorTreasuryPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${PORTAL_LOGIN}?next=/operator/treasury`);

  const params = await searchParams;
  const ctx = await resolveOperatorTenantContext(
    supabase,
    user.id,
    params.tenantId ?? null
  );

  const { data: clientsData, error } = await supabase.rpc(
    "list_operator_treasury_clients",
    { p_tenant_id: ctx.tenantId }
  );

  if (error) {
    console.error("[operator/treasury] list clients", error);
  }

  const clients = (Array.isArray(clientsData) ? clientsData : []) as OperatorTreasuryClientRow[];

  const { data: treasuryMod } = await supabase
    .from("modules")
    .select("id")
    .eq("slug", "treasury")
    .maybeSingle();

  let treasurySeatCost = 1;
  if (treasuryMod) {
    const billing = await resolveBilling(supabase, {
      moduleId: treasuryMod.id,
      distributorTenantId: ctx.tenantId,
    });
    treasurySeatCost = billing.creditCost;
  }

  return (
    <OperatorTreasuryPortfolio
      tenantId={ctx.tenantId}
      tenantName={ctx.tenantName}
      domainSlug={ctx.domainSlug}
      credits={ctx.credits}
      initialClients={clients}
      treasurySeatCost={treasurySeatCost}
    />
  );
}
