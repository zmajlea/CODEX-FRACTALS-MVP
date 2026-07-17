import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  computeSpendPlan,
  loadSpendPlanHistory,
} from "@/lib/server/treasury-spend-plan";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

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
    surface: "spend_plan",
  });

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  const num = (key: string) => {
    const v = url.searchParams.get(key);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };

  const modeParam = url.searchParams.get("mode");
  const mode =
    modeParam === "projection" || modeParam === "backtest" || modeParam === "both"
      ? modeParam
      : "both";

  try {
    if (url.searchParams.get("view") === "history") {
      const history = await loadSpendPlanHistory(guard.admin, clientId, {
        accountId,
        label: url.searchParams.get("label") ?? undefined,
        asOf: url.searchParams.get("as_of") ?? undefined,
      });
      return NextResponse.json(history);
    }

    const result = await computeSpendPlan(guard.admin, clientId, {
      accountId,
      label: url.searchParams.get("label") ?? undefined,
      base: num("base"),
      step: num("step"),
      horizon: num("horizon"),
      startMonth: url.searchParams.get("start_month") ?? undefined,
      startingBuffer: num("starting_buffer"),
      asOf: url.searchParams.get("as_of") ?? undefined,
      mode,
      backtestStart: url.searchParams.get("backtest_start") ?? undefined,
      backtestMonths: num("backtest_months"),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[operator/treasury/spend-plan]", err);
    return NextResponse.json({ error: "Failed to compute spend plan" }, { status: 500 });
  }
}
