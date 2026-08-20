import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  computeTreasuryCashModel,
  loadCashModelInputs,
} from "@/lib/server/treasury-cash-model";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  isCashModelParams,
  isCashModelScenarioArray,
} from "@/lib/treasury/cash-model-types";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Load category series + opening balance (account optional — Spec B6). */
export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id")?.trim() || null;

  try {
    const inputs = await loadCashModelInputs(
      guard.admin,
      clientId,
      accountId,
      url.searchParams.get("as_of") ?? undefined
    );
    return NextResponse.json(inputs);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: {
    accountId?: string | null;
    params?: unknown;
    scenarios?: unknown;
    asOf?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const accountId = body.accountId?.trim() || null;

  const params = isCashModelParams(body.params)
    ? body.params
    : defaultCashModelParams();
  const scenarios = isCashModelScenarioArray(body.scenarios)
    ? body.scenarios
    : defaultCashModelScenarios();

  try {
    const result = await computeTreasuryCashModel(guard.admin, clientId, {
      accountId,
      params,
      scenarios,
      asOf: body.asOf,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cash model failed" },
      { status: 500 }
    );
  }
}
