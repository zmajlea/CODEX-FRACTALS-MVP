import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type BillingMode = "distributor_credits" | "client_stripe";

export type BillingResolution = {
  mode: BillingMode;
  billingRuleId: string | null;
  creditCost: number;
  unitPriceCents: number | null;
  stripePriceId: string | null;
  currency: string;
};

export async function resolveBilling(
  supabase: SupabaseClient<Database>,
  input: {
    moduleId: string;
    distributorTenantId?: string | null;
  }
): Promise<BillingResolution> {
  const { data: ruleId } = await supabase.rpc("resolve_billing_rule_id", {
    p_module_id: input.moduleId,
    p_distributor_tenant_id: input.distributorTenantId ?? undefined,
  });

  if (!ruleId) {
    return {
      mode: "distributor_credits",
      billingRuleId: null,
      creditCost: 1,
      unitPriceCents: null,
      stripePriceId: null,
      currency: "usd",
    };
  }

  const { data: rule } = await supabase
    .from("billing_rules")
    .select("payer, credit_cost, unit_price_cents, stripe_price_id, currency")
    .eq("id", ruleId)
    .maybeSingle();

  return {
    mode: (rule?.payer as BillingMode) ?? "distributor_credits",
    billingRuleId: ruleId as string,
    creditCost: rule?.credit_cost ?? 1,
    unitPriceCents: rule?.unit_price_cents ?? null,
    stripePriceId: rule?.stripe_price_id ?? null,
    currency: rule?.currency ?? "usd",
  };
}
