import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import { computeTreasuryForecast } from "@/lib/server/treasury-forecast";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import type { SummaryGranularity } from "@/lib/treasury/types";

type RouteContext = { params: Promise<{ clientId: string }> };

function parseGranularity(url: URL): SummaryGranularity {
  const g = url.searchParams.get("granularity") ?? "month";
  if (g === "day" || g === "week" || g === "month") return g;
  return "month";
}

export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "forecast",
  });

  const granularity = parseGranularity(new URL(request.url));

  try {
    const result = await computeTreasuryForecast(guard.admin, clientId, granularity);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[operator/treasury/forecast]", err);
    return NextResponse.json({ error: "Failed to compute forecast" }, { status: 500 });
  }
}
