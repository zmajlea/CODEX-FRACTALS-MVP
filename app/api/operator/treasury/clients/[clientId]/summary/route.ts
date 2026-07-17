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
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
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
    const dateRows = await fetchAllRows((rangeFrom, rangeTo) => {
      let q = guard.admin
        .from("treasury_transactions")
        .select("posted_date")
        .eq("client_user_id", clientId)
        .eq("is_removed", false)
        .eq("pending", false)
        .not("posted_date", "is", null)
        .order("posted_date", { ascending: true })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);
      if (accountId) q = q.eq("account_id", accountId);
      return q;
    });

    let dataFirst: string | null = null;
    let dataLast: string | null = null;
    for (const row of dateRows) {
      const d = row.posted_date as string;
      if (!dataFirst || d < dataFirst) dataFirst = d;
      if (!dataLast || d > dataLast) dataLast = d;
    }

    const sparse = await querySummary(guard.admin, clientId, {
      bucket: granularity,
      from,
      to,
      accountId,
    });

    return NextResponse.json(
      buildSummaryResponse(sparse, {
        granularity,
        periods,
        from,
        to,
        starts,
        dataFirst,
        dataLast,
      })
    );
  } catch (err) {
    console.error("[operator/treasury/summary]", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
