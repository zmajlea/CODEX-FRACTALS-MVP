import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sendTransactionalEmail } from "@/lib/email/send";
import { inviteClientEmailHtml } from "@/lib/email/templates-html";
import { emailBrandingFromTenant } from "@/lib/email/branding";
import { getTier } from "@/lib/auth/rbac";

type Body = {
  tenantId?: string;
  clientEmail?: string;
  clientName?: string;
  firmName?: string;
  moduleName?: string;
  inviteUrl?: string;
};

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = body.tenantId?.trim();
  const clientEmail = body.clientEmail?.trim().toLowerCase();
  const clientName = body.clientName?.trim();
  const firmName = body.firmName?.trim() ?? "Your advisor";
  const moduleName = body.moduleName?.trim() ?? "Business Continuity Navigator";
  const inviteUrl = body.inviteUrl?.trim();

  if (!tenantId || !clientEmail || !clientName || !inviteUrl) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data: allowed } = await supabase.rpc("is_operator", {
    p_tenant_id: tenantId,
  });

  if (!allowed && tier !== "global_admin") {
    return NextResponse.json({ error: "Not authorized for this firm" }, { status: 403 });
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, logo_url, brand_color_hex")
    .eq("id", tenantId)
    .maybeSingle();

  const branding = emailBrandingFromTenant({
    name: tenant?.name ?? firmName,
    logo_url: tenant?.logo_url ?? null,
    brand_color_hex: tenant?.brand_color_hex ?? null,
    wordmark: tenant?.name ?? firmName,
  });

  const html = inviteClientEmailHtml({
    branding,
    clientName,
    firmName,
    moduleName,
    inviteUrl,
  });

  const sent = await sendTransactionalEmail({
    to: clientEmail,
    subject: `${firmName} invited you to ${moduleName}`,
    html,
  });

  if (!sent.ok) {
    return NextResponse.json({ error: "Email delivery failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, devLogged: sent.devLogged ?? false });
}
