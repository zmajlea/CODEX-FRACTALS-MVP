import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { fetchRulePayeeStats } from "@/lib/treasury/rule-predicate";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "q required" }, { status: 400 });
  }
  const directionRaw = url.searchParams.get("direction");
  const direction =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const matchType = url.searchParams.get("match_type") ?? "contains";

  try {
    const stats = await fetchRulePayeeStats(guard.admin, clientId, q, {
      direction,
      matchType,
    });
    return NextResponse.json(stats);
  } catch (e) {
    console.error("[payee-stats]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stats failed" },
      { status: 500 }
    );
  }
}
