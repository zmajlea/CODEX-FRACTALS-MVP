import "server-only";

import { NextResponse } from "next/server";
import { operatorHasClientGrant, type OperatorClientGrant } from "@/lib/auth/rbac";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type OperatorTreasuryContext = {
  user: User;
  admin: SupabaseClient<Database>;
  grant: OperatorClientGrant;
  clientId: string;
};

export async function requireOperatorTreasuryGrant(
  clientId: string
): Promise<OperatorTreasuryContext | NextResponse> {
  const supabase = await createClient();
  // Spec 67 C — local JWT verification (getClaims); middleware skips /api/* so this
  // runs once per request, not twice. Do not use getSession() on the server — Supabase
  // warns the cookie user object may not be authentic.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const sub = claimsData?.claims?.sub;
  if (claimsError || !sub || typeof sub !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const claims = claimsData.claims;
  const user = {
    id: sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    app_metadata:
      claims.app_metadata && typeof claims.app_metadata === "object"
        ? (claims.app_metadata as User["app_metadata"])
        : {},
    user_metadata:
      claims.user_metadata && typeof claims.user_metadata === "object"
        ? (claims.user_metadata as User["user_metadata"])
        : {},
    aud: "authenticated",
    created_at: "",
  } as User;

  const admin = createSupabaseAdminClient();
  const grant = await operatorHasClientGrant(
    admin,
    user.id,
    clientId,
    "treasury",
    { allowGlobalAdmin: true }
  );

  if (!grant) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { user, admin, grant, clientId };
}

export function isGuardResponse(
  value: OperatorTreasuryContext | NextResponse
): value is NextResponse {
  return value instanceof NextResponse;
}
