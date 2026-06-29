import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sendTransactionalEmail } from "@/lib/ff/email";
import { getSiteUrl } from "@/lib/site-url";

type Body = {
  vaultId?: string;
  clientName?: string;
  domain?: string;
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
  const clientName = body.clientName?.trim() ?? "Continuity record holder";
  const domain = body.domain?.trim() ?? "demo";

  if (!vaultId) {
    return NextResponse.json({ error: "vaultId required" }, { status: 400 });
  }

  const { data: vault } = await supabase
    .from("vaults")
    .select("id, name, tenant_id, tenants(name, domain_slug)")
    .eq("id", vaultId)
    .maybeSingle();

  if (!vault) {
    return NextResponse.json({ error: "Vault not found" }, { status: 404 });
  }

  const { data: advisors, error: advErr } = await supabase
    .from("ff_trusted_advisors")
    .select("name, email, role")
    .eq("vault_id", vaultId);

  if (advErr) {
    return NextResponse.json({ error: advErr.message }, { status: 403 });
  }

  const tenant = vault.tenants as { name: string; domain_slug: string } | null;
  const firmName = tenant?.name ?? "Financial Firefighter partner firm";
  const origin = getSiteUrl(request.headers.get("origin") ?? undefined);
  const portalUrl = `${origin}/${tenant?.domain_slug ?? domain}/wizard`;

  const deliveries = await Promise.all(
    (advisors ?? []).map((a) =>
      sendTransactionalEmail({
        to: a.email,
        subject: `Emergency continuity protocol activated — ${clientName}`,
        html: `<p>Hello ${a.name},</p>
<p>The continuity protocol has been activated for <strong>${clientName}</strong> through <strong>${firmName}</strong>.</p>
<p>Your role on file: <strong>${a.role}</strong>.</p>
<p>This message contains no decrypted financial data. Sign in to the continuity portal for next steps: <a href="${portalUrl}">${portalUrl}</a></p>`,
      })
    )
  );

  if (deliveries.some((d) => !d.ok)) {
    return NextResponse.json({ error: "One or more emails failed" }, { status: 502 });
  }

  await supabase.from("record_activity_events").insert({
    vault_id: vaultId,
    event_type: "protocol_activated",
    actor_id: user.id,
    payload: {
      advisor_count: advisors?.length ?? 0,
      firm: firmName,
    },
  });

  return NextResponse.json({
    ok: true,
    notified: advisors?.length ?? 0,
  });
}
