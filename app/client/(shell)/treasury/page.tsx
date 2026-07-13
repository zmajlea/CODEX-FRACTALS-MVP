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
  if (user) {
    const { count } = await supabase
      .from("treasury_accounts")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", user.id);
    hasLinkedAccounts = (count ?? 0) > 0;
  }

  if (!hasLinkedAccounts) {
    return <ClientTreasuryEmptyState />;
  }

  return (
    <Suspense fallback={<p className="p-8 text-sm">Loading Treasury…</p>}>
      <TreasuryDashboard />
    </Suspense>
  );
}
