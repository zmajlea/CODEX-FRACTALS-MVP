import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { loadCommittedFlows } from "@/lib/server/treasury-committed-flows";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id")?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "account_id required" }, { status: 400 });
  }

  const horizonDays = Number(url.searchParams.get("days") ?? "30");

  try {
    const result = await loadCommittedFlows(guard.admin, clientId, accountId, {
      asOf: url.searchParams.get("as_of") ?? undefined,
      horizonDays: Number.isFinite(horizonDays) ? horizonDays : 30,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Load failed" },
      { status: 500 }
    );
  }
}
