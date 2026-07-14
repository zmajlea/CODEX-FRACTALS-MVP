import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  buildSummaryResponse,
  clampSummaryPeriods,
  parseSummaryGranularity,
} from "@/lib/server/treasury-summary-response";
import { querySummary } from "@/lib/server/treasury-rules";
import { lastNPeriodStarts } from "@/lib/treasury/period-bounds";

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
    surface: "summary",
  });

  const url = new URL(request.url);
  const granularity = parseSummaryGranularity(url);
  const periods = clampSummaryPeriods(url.searchParams.get("periods"));
  const accountId = url.searchParams.get("account_id") ?? undefined;

  const { from, to, starts } = lastNPeriodStarts(granularity, periods);

  try {
    const sparse = await querySummary(guard.admin, clientId, {
      bucket: granularity,
      from,
      to,
      accountId,
    });

    return NextResponse.json(
      buildSummaryResponse(sparse, { granularity, periods, from, to, starts })
    );
  } catch (err) {
    console.error("[operator/treasury/summary]", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
