import { createClient } from "@/utils/supabase/server";
import { redirect, notFound } from "next/navigation";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { operatorHasClientGrant } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OperatorTreasuryClientRecord } from "@/components/operator/OperatorTreasuryClientRecord";
import { resolveOperatorTenantContext } from "@/lib/operator/resolve-operator-tenant";

type Props = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{
    tenantId?: string;
    tab?: string;
    view?: string;
    study?: string;
    draft?: string;
  }>;
};

export default async function OperatorTreasuryClientPage({
  params,
  searchParams,
}: Props) {
  const { clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`${PORTAL_LOGIN}?next=/operator/treasury/clients/${clientId}`);
  }

  const query = await searchParams;
  const ctx = await resolveOperatorTenantContext(
    supabase,
    user.id,
    query.tenantId ?? null
  );

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
  const meta = clientUser?.user?.user_metadata as Record<string, unknown> | undefined;
  const clientName =
    (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta?.name === "string" && meta.name.trim()) ||
    clientUser?.user?.email?.split("@")[0] ||
    "Client";
  const clientEmail = clientUser?.user?.email ?? "";

  const { data: clientsData } = await supabase.rpc("list_operator_treasury_clients", {
    p_tenant_id: ctx.tenantId,
  });
  const portfolioRow = (
    Array.isArray(clientsData) ? clientsData : []
  ).find(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      "client_user_id" in row &&
      (row as { client_user_id: string }).client_user_id === clientId
  ) as { watch_note?: string | null } | undefined;

  const watchNote =
    typeof portfolioRow?.watch_note === "string" && portfolioRow.watch_note.trim()
      ? portfolioRow.watch_note.trim()
      : null;

  return (
    <OperatorTreasuryClientRecord
      tenantId={ctx.tenantId}
      tenantName={ctx.tenantName}
      domainSlug={ctx.domainSlug}
      clientUserId={clientId}
      clientName={clientName}
      clientEmail={clientEmail}
      grantId={grant.grantId}
      watchNote={watchNote}
      initialTab={query.tab}
      initialAnalyticsView={query.view}
      initialStudyId={query.study}
      initialDraftId={query.draft}
    />
  );
}
