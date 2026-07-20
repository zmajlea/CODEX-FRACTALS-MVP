import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  DEMO_INSTRUMENT_CLIENT_EMAIL,
  isProtectedDemoFfmClient,
} from "@/lib/treasury/is-demo-tenant";

type RouteContext = { params: Promise<{ clientId: string }> };

async function resolveClientEmail(
  admin: SupabaseClient<Database>,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("email")
    .eq("id", clientId)
    .maybeSingle();
  return data?.email ?? null;
}

/**
 * Spec 49B Step 1: refuse protected demo FFM; otherwise 501.
 * No delete paths until Step 1 proof passes against the live demo client.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const clientEmail = await resolveClientEmail(guard.admin, clientId);

  if (
    isProtectedDemoFfmClient({
      clientId,
      clientEmail,
    })
  ) {
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

  return NextResponse.json(
    {
      error: "Reset client data is not enabled yet.",
      code: "reset_not_implemented",
    },
    { status: 501 }
  );
}
