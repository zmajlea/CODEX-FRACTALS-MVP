import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sendTransactionalEmail } from "@/lib/ff/email";

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

  const sent = await sendTransactionalEmail({
    to: email,
    subject: "You have been named a trusted advisor",
    html: `<p>Hello ${name},</p>
<p>You have been added as a trusted advisor (<strong>${role}</strong>) on a continuity record for <strong>${clientName}</strong>.</p>
<p>No financial details are included in this message. Your firm will guide next steps if the continuity protocol is activated.</p>`,
  });

  if (!sent.ok) {
    return NextResponse.json({ error: "Email delivery failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
