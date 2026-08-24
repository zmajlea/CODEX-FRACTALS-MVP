import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  consumeInvite,
  lookupInviteByToken,
} from "@/lib/server/treasury-onboarding";

type Body = { token?: string; password?: string };

/**
 * Spec B10 Part B — validate invite token, set password, mark consumed.
 * Client then signs in from the activation form.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = body.token?.trim() ?? "";
  const password = body.password ?? "";
  if (!token || password.length < 8) {
    return NextResponse.json(
      { error: "Token and password (8+ chars) required" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const lookup = await lookupInviteByToken(admin, token);
  if (!lookup.ok) {
    const messages: Record<string, string> = {
      invalid: "This invite link is invalid.",
      expired: "This invite has expired. Ask your advisor to send a new one.",
      consumed: "This invite was already used.",
      revoked: "This invite was revoked. Ask your advisor to send a new one.",
    };
    return NextResponse.json(
      { error: messages[lookup.error] ?? "Invalid invite" },
      { status: 400 }
    );
  }

  const { error: pwErr } = await admin.auth.admin.updateUserById(
    lookup.invite.client_user_id,
    { password }
  );
  if (pwErr) {
    return NextResponse.json({ error: pwErr.message }, { status: 500 });
  }

  await consumeInvite(admin, lookup.invite.id);

  return NextResponse.json({
    ok: true,
    email: lookup.invite.email,
  });
}
