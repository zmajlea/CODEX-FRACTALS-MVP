import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getTenantByDomain } from "@/lib/ff/tenant";
import { ffRouteGuardRedirect, parseFfLoginRoute } from "@/lib/ff/routing";
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

  const { data: routeData } = await supabase.rpc("get_ff_login_route");
  const guard = ffRouteGuardRedirect(
    `/${domain}/admin`,
    parseFfLoginRoute(routeData)
  );
  if (guard) {
    redirect(guard);
  }

  return (
    <AdminDashboard
      tenantId={tenant.id}
      domain={domain}
      initialCredits={tenant.available_credits}
    />
  );
}
