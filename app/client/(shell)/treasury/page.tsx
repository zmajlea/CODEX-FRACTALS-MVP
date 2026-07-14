import { Suspense } from "react";
import { createClient } from "@/utils/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TreasuryDashboard } from "@/components/treasury/TreasuryDashboard";
import { ClientTreasuryEmptyState } from "@/components/treasury/ClientTreasuryEmptyState";

export default async function ClientTreasuryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let hasLinkedAccounts = false;
  let hasRecommendations = false;
  if (user) {
    const { count: accountCount } = await supabase
      .from("treasury_accounts")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", user.id);
    hasLinkedAccounts = (accountCount ?? 0) > 0;

    const admin = createSupabaseAdminClient();
    const { count: recCount } = await admin
      .from("treasury_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", user.id)
      .neq("status", "draft");
    hasRecommendations = (recCount ?? 0) > 0;
  }

  if (!hasLinkedAccounts && !hasRecommendations) {
    return <ClientTreasuryEmptyState />;
  }

  return (
    <Suspense fallback={<p className="p-8 text-sm">Loading Treasury…</p>}>
      <TreasuryDashboard />
    </Suspense>
  );
}
