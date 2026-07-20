import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  computeTreasuryForecast,
  emptyTreasuryForecast,
} from "@/lib/server/treasury-forecast";
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

  const url = new URL(request.url);
  const granularity = parseGranularity(url);
  const accountIdParam = url.searchParams.get("accountId")?.trim() || null;

  try {
    const { count: accountCount } = await guard.admin
      .from("treasury_accounts")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId);

    // Spec 50 amendment: empty books must not 400 — same insufficient empty as today.
    if ((accountCount ?? 0) === 0) {
      return NextResponse.json(emptyTreasuryForecast(granularity));
    }

    if (!accountIdParam) {
      return NextResponse.json(
        { error: "accountId is required when the client has accounts" },
        { status: 400 }
      );
    }

    const result = await computeTreasuryForecast(
      guard.admin,
      clientId,
      granularity,
      accountIdParam
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute forecast";
    if (message.startsWith("Account not found")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[operator/treasury/forecast]", err);
    return NextResponse.json({ error: "Failed to compute forecast" }, { status: 500 });
  }
}
