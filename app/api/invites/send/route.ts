import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sendTransactionalEmail } from "@/lib/email/send";
import { trustedAdvisorInviteEmailHtml } from "@/lib/email/templates-html";
import { emailBrandingFromTenant } from "@/lib/email/branding";
import { resolveModuleThemeFromRpcPayload } from "@/lib/branding/resolve-theme";
import { getTier } from "@/lib/auth/rbac";

type Body = {
  vaultId?: string;
  name?: string;
  email?: string;
  role?: string;
  clientName?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const vaultId = body.vaultId?.trim();
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const role = body.role?.trim();
  const clientName = body.clientName?.trim() ?? "a client";

  if (!vaultId || !name || !email || !role) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { error: insertErr } = await supabase.from("ff_trusted_advisors").insert({
    vault_id: vaultId,
    name,
    email,
    role,
    created_by: user.id,
  });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 403 });
  }

  const { data: grant } = await supabase
    .from("client_module_access")
    .select("id")
    .eq("vault_id", vaultId)
    .eq("client_user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  let branding = emailBrandingFromTenant({ name: "Business Continuity Navigator" });

  if (grant?.id) {
    const { data: payload } = await supabase.rpc("get_client_module_branding", {
      p_grant_id: grant.id,
    });
    if (payload && typeof payload === "object") {
      const theme = resolveModuleThemeFromRpcPayload(
        payload as Parameters<typeof resolveModuleThemeFromRpcPayload>[0]
      );
      branding = emailBrandingFromTenant({
        name: theme.wordmark ?? "Business Continuity Navigator",
        logo_url: theme.logoUrl,
        brand_color_hex: (payload as { tenant_brand_color_hex?: string | null })
          .tenant_brand_color_hex,
        wordmark: theme.wordmark,
      });
    }
  } else {
    const tier = await getTier(supabase, user.id);
    if (tier === "operator" || tier === "global_admin") {
      const { data: vault } = await supabase
        .from("vaults")
        .select("tenant_id, tenants(name, logo_url, brand_color_hex)")
        .eq("id", vaultId)
        .maybeSingle();
      const tenant = vault?.tenants as {
        name: string;
        logo_url: string | null;
        brand_color_hex: string | null;
      } | null;
      if (tenant) {
        branding = emailBrandingFromTenant({
          name: tenant.name,
          logo_url: tenant.logo_url,
          brand_color_hex: tenant.brand_color_hex,
        });
      }
    }
  }

  const html = trustedAdvisorInviteEmailHtml({
    branding,
    advisorName: name,
    role,
    clientName,
  });

  const sent = await sendTransactionalEmail({
    to: email,
    subject: "You have been named a trusted advisor",
    html,
  });

  if (!sent.ok) {
    return NextResponse.json({ error: "Email delivery failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, devLogged: sent.devLogged ?? false });
}
