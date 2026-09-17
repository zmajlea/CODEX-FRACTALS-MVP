import { createClient } from "@/utils/supabase/server";
import { redirect, notFound } from "next/navigation";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { operatorHasClientGrant } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ModelsMetricsWorkbench } from "@/components/operator/treasury/ModelsMetricsWorkbench";

type Props = {
  params: Promise<{ clientId: string }>;
};

/** B28 Module A — standalone Models & Metrics workbench (not a rail tab). */
export default async function OperatorTreasuryWorkbenchPage({ params }: Props) {
  const { clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `${PORTAL_LOGIN}?next=/operator/treasury/clients/${clientId}/workbench`
    );
  }

  const admin = createSupabaseAdminClient();
  const grant = await operatorHasClientGrant(
    admin,
    user.id,
    clientId,
    "treasury",
    { allowGlobalAdmin: true }
  );

  if (!grant) {
    notFound();
  }

  const { data: clientUser } = await admin.auth.admin.getUserById(clientId);
  const meta = clientUser?.user?.user_metadata as
    | Record<string, unknown>
    | undefined;
  const clientName =
    (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta?.name === "string" && meta.name.trim()) ||
    clientUser?.user?.email?.split("@")[0] ||
    "Client";

  return (
    <ModelsMetricsWorkbench clientUserId={clientId} clientName={clientName} />
  );
}
