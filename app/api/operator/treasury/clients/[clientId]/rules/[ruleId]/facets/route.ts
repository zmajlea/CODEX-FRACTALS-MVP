import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

export type RuleQueueFacets = {
  combos: Array<{ labels: string[]; count: number }>;
  confirmed: number;
  rejected: number;
};

/**
 * Spec 61 — facet buckets for a rule's queue.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: rule } = await guard.admin
    .from("treasury_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();
  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const { data, error } = await guard.admin.rpc("treasury_rule_queue_facets", {
    p_client: clientId,
    p_rule: ruleId,
  });
  if (error) {
    console.error("[treasury/facets]", error);
    return NextResponse.json({ error: "Failed to load facets" }, { status: 500 });
  }

  const facets = data as RuleQueueFacets;
  return NextResponse.json({ facets });
}
