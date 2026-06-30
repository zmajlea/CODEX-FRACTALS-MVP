import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { requireTier } from "@/lib/auth/rbac";
import { GlobalAdminPanel } from "@/components/platform/GlobalAdminPanel";
import "@/app/ff/ff-v1.css";

export default async function GlobalAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin");

  await requireTier(supabase, user.id, ["global_admin"]);

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, domain_slug, credit_balance, brand_color_hex")
    .order("name");

  const { data: billingRules } = await supabase
    .from("billing_rules")
    .select("id, scope, payer, credit_cost")
    .eq("active", true);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <p className="text-xs uppercase tracking-wide text-codex-muted mb-2">CodexOne · Tier 1</p>
      <h1 className="font-head text-3xl text-obsidian mb-8">Global Admin</h1>
      <GlobalAdminPanel
        tenants={(tenants ?? []).map((t) => ({
          ...t,
          credit_balance: Number(t.credit_balance ?? 0),
        }))}
        billingRules={billingRules ?? []}
      />
    </div>
  );
}
