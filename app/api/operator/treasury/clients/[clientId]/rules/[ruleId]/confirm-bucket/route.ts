import { NextResponse } from "next/server";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import type { RuleQueueFacets } from "../facets/route";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

type Body = {
  combo?: string[];
};

/**
 * Spec 61 — confirm every tx in a suggestion-combo bucket as this rule's category.
 * Server-side by rule+combo (no client id array).
 */
export async function POST(request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const combo = (body.combo ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (combo.length === 0) {
    return NextResponse.json({ error: "combo required" }, { status: 400 });
  }

  const { data: rule } = await guard.admin
    .from("treasury_rules")
    .select("id, assign_label, active")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();
  if (!rule) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
  if (!rule.active) {
    return NextResponse.json({ error: "Rule is paused" }, { status: 400 });
  }

  const { data: confirmJson, error: confirmErr } = await guard.admin.rpc(
    "treasury_rule_queue_combo_confirm",
    {
      p_client: clientId,
      p_rule: ruleId,
      p_combo: combo,
      p_actor: guard.user.id,
    }
  );
  if (confirmErr) {
    console.error("[treasury/confirm-bucket]", confirmErr);
    return NextResponse.json(
      { error: confirmErr.message ?? "Confirm bucket failed" },
      { status: 500 }
    );
  }

  const confirmed =
    (confirmJson as { confirmed?: number } | null)?.confirmed ?? 0;

  const { data: facetsJson } = await guard.admin.rpc(
    "treasury_rule_queue_facets",
    { p_client: clientId, p_rule: ruleId }
  );

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_tx_bucket_confirmed",
    payload: {
      client_user_id: clientId,
      rule_id: ruleId,
      combo,
      confirmed,
      label: rule.assign_label,
    },
  });

  return NextResponse.json({
    confirmed,
    facets: facetsJson as RuleQueueFacets,
  });
}
