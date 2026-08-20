import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

/** Spec B3 — Discard a proposed MCP rule (no apply). */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: before } = await guard.admin
    .from("treasury_rules")
    .select("id, status")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (!before) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  if (before.status !== "proposed") {
    return NextResponse.json(
      { error: "Only proposed rules can be discarded this way" },
      { status: 400 }
    );
  }

  const { error } = await guard.admin
    .from("treasury_rules")
    .update({ status: "discarded", active: false })
    .eq("id", ruleId)
    .eq("client_user_id", clientId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
