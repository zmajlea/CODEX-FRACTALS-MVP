import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { computeReviewPreflight } from "@/lib/treasury/review-preflight";

type RouteContext = { params: Promise<{ clientId: string; reviewId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  try {
    const preflight = await computeReviewPreflight(guard.admin, reviewId);
    return NextResponse.json({ preflight });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preflight failed" },
      { status: 404 }
    );
  }
}
