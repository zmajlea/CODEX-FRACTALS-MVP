import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { previewRuleApply } from "@/lib/treasury/apply-rules-for-client";
import type { TreasuryRuleRow } from "@/lib/treasury/types";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

/**
 * Spec 58 Phase 2 — match breakdown for apply UI.
 * Query: from?, to? (date scope for categorised counts only).
 */
export async function GET(request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: rule, error } = await guard.admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (error || !rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const breakdown = await previewRuleApply(
    guard.admin,
    clientId,
    rule as TreasuryRuleRow,
    { from, to }
  );

  return NextResponse.json({ breakdown });
}
