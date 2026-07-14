import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { applyRulesForClient } from "@/lib/server/treasury-rules";
import {
  isTransactionsSyncStale,
  readTreasuryCacheForClient,
  syncTreasuryForClient,
} from "@/lib/server/treasury-sync";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "accounts",
  });

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const stale = refresh ? false : await isTransactionsSyncStale(guard.admin, clientId);
  const shouldSync = refresh || stale;

  try {
    const result = shouldSync
      ? await syncTreasuryForClient(guard.admin, clientId)
      : await readTreasuryCacheForClient(guard.admin, clientId);

    if (shouldSync) {
      await applyRulesForClient(guard.admin, clientId);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[operator/treasury/accounts]", err);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}
