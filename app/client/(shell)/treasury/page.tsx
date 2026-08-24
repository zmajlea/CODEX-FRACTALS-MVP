import { Suspense } from "react";
import { createClient } from "@/utils/supabase/server";
import { TreasuryDashboard } from "@/components/treasury/TreasuryDashboard";
import { ClientTreasuryEmptyState } from "@/components/treasury/ClientTreasuryEmptyState";

export default async function ClientTreasuryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let hasLinkedAccounts = false;
  let hasRecommendations = false;
  let hasSharedAnalytics = false;
  if (user) {
    // Spec B10 — all presence checks via session client (RLS boundary).
    const { count: accountCount } = await supabase
      .from("treasury_accounts")
      .select("id", { count: "exact", head: true });
    hasLinkedAccounts = (accountCount ?? 0) > 0;

    const { count: recCount } = await supabase
      .from("treasury_recommendations")
      .select("id", { count: "exact", head: true });
    hasRecommendations = (recCount ?? 0) > 0;

    const { count: boardCount } = await supabase
      .from("treasury_analytics")
      .select("id", { count: "exact", head: true });
    hasSharedAnalytics = (boardCount ?? 0) > 0;
  }

  if (!hasLinkedAccounts && !hasRecommendations && !hasSharedAnalytics) {
    return <ClientTreasuryEmptyState />;
  }

  return (
    <Suspense fallback={<p className="p-8 text-sm">Loading Treasury…</p>}>
      <TreasuryDashboard />
    </Suspense>
  );
}
