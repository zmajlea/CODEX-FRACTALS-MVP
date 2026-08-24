import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getPrimaryOperatorTenantId,
  getTier,
} from "@/lib/auth/rbac";
import { createTreasuryClient } from "@/lib/server/treasury-onboarding";
import { sendTransactionalEmail } from "@/lib/email/send";
import { inviteClientEmailHtml } from "@/lib/email/templates-html";
import { emailBrandingFromTenant } from "@/lib/email/branding";

type Body = {
  name?: string;
  email?: string;
  firmLabel?: string;
  sendInvite?: boolean;
};

/**
 * Spec B10 Part A — operator creates a treasury client + grant (no seed).
 */
export async function POST(request: Request) {
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

  const tenantId = await getPrimaryOperatorTenantId(supabase, user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "No operator tenant" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!name || !email) {
    return NextResponse.json(
      { error: "name and email required" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  try {
    const result = await createTreasuryClient(admin, {
      tenantId,
      operatorUserId: user.id,
      email,
      name,
      firmLabel: body.firmLabel?.trim(),
    });

    const sendInvite = body.sendInvite !== false;
    let inviteSent = false;
    if (sendInvite) {
      const origin =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
        new URL(request.url).origin;
      const inviteUrl = `${origin}/portal/activate?token=${encodeURIComponent(result.inviteToken)}`;

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

      const html = inviteClientEmailHtml({
        branding,
        clientName: name,
        firmName,
        moduleName: "Summit Treasury",
        inviteUrl,
      });

      const sent = await sendTransactionalEmail({
        to: email,
        subject: `${firmName} invited you to Summit Treasury`,
        html,
      });
      inviteSent = sent.ok;
    }

    return NextResponse.json(
      {
        clientId: result.clientId,
        grantId: result.grantId,
        created: result.created,
        inviteId: result.inviteId,
        inviteSent,
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("another firm")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
