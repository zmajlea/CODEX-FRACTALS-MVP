import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getTenantByDomain } from "@/lib/ff/tenant";
import { AdminDashboard } from "@/components/ff/AdminDashboard";

type Props = {
  params: Promise<{ domain: string }>;
};

export default async function TenantAdminPage({ params }: Props) {
  const { domain } = await params;
  const tenant = await getTenantByDomain(domain);
  if (!tenant) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/${domain}/admin`);
  }

  return (
    <AdminDashboard
      tenantId={tenant.id}
      domain={domain}
      initialCredits={tenant.available_credits}
    />
  );
}
