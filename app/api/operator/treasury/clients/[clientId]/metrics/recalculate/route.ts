import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { recalculateClientMetrics } from "@/lib/treasury/metrics-eval";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Spec B5 — recompute all active metrics for this client. */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  try {
    const results = await recalculateClientMetrics(
      guard.admin,
      guard.grant.tenantId,
      clientId
    );
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
