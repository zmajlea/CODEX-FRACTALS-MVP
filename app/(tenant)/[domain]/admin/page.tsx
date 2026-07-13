import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getTenantByDomain } from "@/lib/bcn/tenant";
import { ffRouteGuardRedirect, parseBcnLoginRoute } from "@/lib/bcn/routing";
import { AdminDashboard } from "@/components/bcn/AdminDashboard";

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
    parseBcnLoginRoute(routeData)
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
