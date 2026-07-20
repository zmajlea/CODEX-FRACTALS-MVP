import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  countClientDataForReset,
  RESET_PARTIAL_OPERATOR_HINT,
  ResetPartialError,
  wipeClientTreasuryData,
} from "@/lib/server/treasury-client-reset";
import {
  DEMO_INSTRUMENT_CLIENT_EMAIL,
  isProtectedDemoFfmClient,
} from "@/lib/treasury/is-demo-tenant";

type RouteContext = { params: Promise<{ clientId: string }> };
type AdminClient = SupabaseClient<Database>;

async function resolveClientEmail(
  admin: AdminClient,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("email")
    .eq("id", clientId)
    .maybeSingle();
  return data?.email ?? null;
}

async function resolveClientDisplayName(
  admin: AdminClient,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("display_name")
    .eq("id", clientId)
    .maybeSingle();
  return data?.display_name?.trim() || null;
}

function refuseProtected(clientId: string, clientEmail: string | null) {
  return NextResponse.json(
    {
      error:
        "This record is protected. The demo FFM book cannot be reset.",
      code: "protected_demo_ffm",
      client_user_id: clientId,
      client_email: clientEmail ?? DEMO_INSTRUMENT_CLIENT_EMAIL,
    },
    { status: 403 }
  );
}

/** Preview real counts for the confirm dialog. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const clientEmail = await resolveClientEmail(guard.admin, clientId);
  if (isProtectedDemoFfmClient({ clientId, clientEmail })) {
    return refuseProtected(clientId, clientEmail);
  }

  const displayName = await resolveClientDisplayName(guard.admin, clientId);
  const counts = await countClientDataForReset(guard.admin, clientId);

  return NextResponse.json({
    client_user_id: clientId,
    client_email: clientEmail,
    display_name: displayName,
    counts,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const clientEmail = await resolveClientEmail(guard.admin, clientId);
  if (isProtectedDemoFfmClient({ clientId, clientEmail })) {
    return refuseProtected(clientId, clientEmail);
  }

  let body: { confirm_name?: string } = {};
  try {
    body = (await request.json()) as { confirm_name?: string };
  } catch {
    return NextResponse.json(
      { error: "JSON body required with confirm_name" },
      { status: 400 }
    );
  }

  const displayName = await resolveClientDisplayName(guard.admin, clientId);
  const expected = (displayName || clientEmail || "").trim();
  const provided = (body.confirm_name ?? "").trim();
  if (!expected || provided !== expected) {
    return NextResponse.json(
      {
        error: "Type the client’s exact name to confirm.",
        code: "confirm_name_mismatch",
        expected_name: expected,
      },
      { status: 400 }
    );
  }

  try {
    const counts = await wipeClientTreasuryData(guard.admin, clientId);

    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_client_data_reset",
      payload: {
        client_user_id: clientId,
        tenant_id: guard.grant.tenantId,
        display_name: displayName,
        counts,
      },
    });

    return NextResponse.json({ ok: true, counts });
  } catch (e) {
    const message =
      e instanceof ResetPartialError
        ? `${e.message} ${RESET_PARTIAL_OPERATOR_HINT}`
        : e instanceof Error
          ? e.message
          : "Reset failed";
    return NextResponse.json(
      {
        error: message,
        code: "reset_partial_or_failed",
        hint: RESET_PARTIAL_OPERATOR_HINT,
        counts: e instanceof ResetPartialError ? e.counts : undefined,
      },
      { status: 500 }
    );
  }
}
