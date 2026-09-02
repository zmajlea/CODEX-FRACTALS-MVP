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
  // Read session from cookies (no Auth API round-trip); grant check is the real gate.
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (sessionError || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
