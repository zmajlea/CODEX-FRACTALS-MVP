import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { applyRulesForClient } from "@/lib/server/treasury-rules";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

/**
 * Spec B3 — Confirm a proposed MCP rule → active + apply (suggestions only).
 */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: before, error: findErr } = await guard.admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  if (before.status !== "proposed") {
    return NextResponse.json(
      { error: "Only proposed rules can be confirmed" },
      { status: 400 }
    );
  }

  const { data: rule, error } = await guard.admin
    .from("treasury_rules")
    .update({ status: "active", active: true })
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const suggested = await applyRulesForClient(guard.admin, clientId, ruleId);
  return NextResponse.json({ rule, suggested });
}
