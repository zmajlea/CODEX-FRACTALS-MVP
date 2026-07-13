import { NextResponse } from "next/server";
import { operatorHasClientGrant } from "@/lib/auth/rbac";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  readTreasuryCacheForClient,
  syncTreasuryForClient,
} from "@/lib/server/treasury-sync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
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

  await writeOperatorTreasuryReadAudit(admin, {
    actorUserId: user.id,
    clientUserId: clientId,
    tenantId: grant.tenantId,
    grantId: grant.grantId,
  });

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const result = refresh
      ? await syncTreasuryForClient(admin, clientId)
      : await readTreasuryCacheForClient(admin, clientId);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[operator/treasury/accounts]", err);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}
