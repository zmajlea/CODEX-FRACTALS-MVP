import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { applyRuleActions } from "@/lib/treasury/apply-rules-for-client";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

type ApplyBody = {
  /** Group 1 — default true */
  suggestUncategorised?: boolean;
  /** Group 2 — default true */
  suggestAlongside?: boolean;
  /** Group 3 — default false */
  recategorise?: boolean;
  /** Date scope for recategorise only (YYYY-MM-DD) */
  from?: string | null;
  to?: string | null;
};

/**
 * Spec 58 Phase 2 — apply with explicit group choices + optional recategorise scope.
 */
export async function POST(request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: ApplyBody = {};
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    body = {};
  }

  const { data: rule } = await guard.admin
    .from("treasury_rules")
    .select("id, active")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  if (!rule.active) {
    return NextResponse.json({ error: "Rule is paused" }, { status: 400 });
  }

  if (body.recategorise === true) {
    if (body.from != null && body.from !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(body.from)) {
      return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
    }
    if (body.to != null && body.to !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(body.to)) {
      return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
    }
  }

  const result = await applyRuleActions(guard.admin, clientId, {
    ruleId,
    suggestUncategorised: body.suggestUncategorised !== false,
    suggestAlongside: body.suggestAlongside !== false,
    recategorise: body.recategorise === true,
    from: body.recategorise ? body.from || null : null,
    to: body.recategorise ? body.to || null : null,
    actorUserId: guard.user.id,
  });

  const { data: refreshed } = await guard.admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle();

  return NextResponse.json({
    rule: refreshed,
    suggested: result.suggested,
    recategorised: result.recategorised,
    skippedManual: result.skippedManual,
  });
}
