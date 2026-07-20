import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { OperatorTreasuryInbox } from "@/components/operator/treasury/OperatorTreasuryInbox";
import { OperatorTreasuryInboxShell } from "@/components/operator/treasury/OperatorTreasuryInboxShell";
import { resolveOperatorTenantContext } from "@/lib/operator/resolve-operator-tenant";

type Props = {
  searchParams: Promise<{ tenantId?: string }>;
};

export default async function OperatorTreasuryInboxPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${PORTAL_LOGIN}?next=/operator/treasury/inbox`);

  const params = await searchParams;
  const ctx = await resolveOperatorTenantContext(
    supabase,
    user.id,
    params.tenantId ?? null
  );

  const display =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    user.email?.split("@")[0] ||
    "Operator";

  return (
    <OperatorTreasuryInboxShell
      tenantId={ctx.tenantId}
      tenantName={ctx.tenantName}
      who={display}
    >
      <div className="view on">
        <OperatorTreasuryInbox tenantId={ctx.tenantId} domainSlug={ctx.domainSlug} />
      </div>
    </OperatorTreasuryInboxShell>
  );
}
