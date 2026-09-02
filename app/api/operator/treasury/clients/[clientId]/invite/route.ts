import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getPrimaryOperatorTenantId,
  getTier,
  operatorHasClientGrant,
} from "@/lib/auth/rbac";
import {
  mintDistributorInvite,
} from "@/lib/server/treasury-onboarding";
import { sendTransactionalEmail } from "@/lib/email/send";
import { inviteClientEmailHtml } from "@/lib/email/templates-html";
import { emailBrandingFromTenant } from "@/lib/email/branding";

type RouteContext = { params: Promise<{ clientId: string }> };

type Body = { action?: "send" | "revoke" };

/** Spec B10 — resend or revoke treasury activation invite. */
export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tier = await getTier(supabase, user.id);
  if (tier !== "operator" && tier !== "global_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const grant = await operatorHasClientGrant(
    admin,
    user.id,
    clientId,
    "treasury",
    { allowGlobalAdmin: true }
  );
  // Allow invite actions even when suspended — look up any grant for tenant
  const tenantId =
    grant?.tenantId ?? (await getPrimaryOperatorTenantId(supabase, user.id));
  if (!tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    /* default send */
  }
  const action = body.action ?? "send";

  if (action === "revoke") {
    await admin
      .from("distributor_client_invites")
      .update({ status: "revoked" })
      .eq("tenant_id", tenantId)
      .eq("client_user_id", clientId)
      .eq("status", "pending");
    return NextResponse.json({ ok: true });
  }

  const { data: authUser } = await admin.auth.admin.getUserById(clientId);
  const email = authUser.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Client email missing" }, { status: 400 });
  }
  const name =
    (authUser.user?.user_metadata?.full_name as string | undefined) ??
    email.split("@")[0]!;

  const invite = await mintDistributorInvite(admin, {
    tenantId,
    clientUserId: clientId,
    email,
    createdBy: user.id,
  });

  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;
  const inviteUrl = `${origin}/portal/activate?token=${encodeURIComponent(invite.token)}`;

  const { data: tenant } = await admin
    .from("tenants")
    .select("name, logo_url, brand_color_hex")
    .eq("id", tenantId)
    .maybeSingle();
  const firmName = tenant?.name ?? "Your advisor";
  const branding = emailBrandingFromTenant({
    name: firmName,
    logo_url: tenant?.logo_url ?? null,
    brand_color_hex: tenant?.brand_color_hex ?? null,
    wordmark: firmName,
  });

  const sent = await sendTransactionalEmail({
    to: email,
    subject: `${firmName} invited you to Summit Treasury`,
    html: inviteClientEmailHtml({
      branding,
      clientName: name,
      firmName,
      moduleName: "Summit Treasury",
      inviteUrl,
    }),
  });

  return NextResponse.json({
    ok: true,
    inviteId: invite.id,
    inviteUrl,
    inviteSent: sent.ok && !sent.emailSkipped,
    emailSkipped: sent.emailSkipped ?? false,
  });
}
