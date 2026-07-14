import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { BcnContinuityShell } from "@/components/bcn/BcnContinuityShell";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { OperatorTreasuryInbox } from "@/components/operator/treasury/OperatorTreasuryInbox";
import { resolveOperatorTenantContext } from "@/lib/operator/resolve-operator-tenant";
import Link from "next/link";

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

  const wordmark = defaultWordmark("summit");
  const display =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    user.email?.split("@")[0] ||
    "Operator";

  return (
    <BcnContinuityShell
      mode="operator"
      dataBrand="summit"
      wordmark={wordmark}
      homeHref="/operator"
      recordPill={{ primary: "Treasury workspace", secondary: ctx.tenantName }}
      who={display}
      keyUnlocked
      railGroups={[
        {
          label: "Practice",
          items: [
            {
              id: "treasury-portfolio",
              icon: "grid",
              label: "Portfolio Dashboard",
              href: "/operator/treasury",
            },
            {
              id: "treasury-inbox",
              icon: "inbox",
              label: "Inbox",
              active: true,
              href: "/operator/treasury/inbox",
            },
          ],
        },
      ]}
      showBcnSolutionLine
    >
      <div className="view on">
        <nav className="text-sm text-codex-muted mb-4">
          <Link href="/operator/treasury" className="hover:text-ink">
            Portfolio Dashboard
          </Link>
          <span className="mx-2">›</span>
          <span className="text-ink">Inbox</span>
        </nav>
        <OperatorTreasuryInbox tenantId={ctx.tenantId} />
      </div>
    </BcnContinuityShell>
  );
}
