import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  applyRulesForClient,
  reconcileRuleSuggestions,
} from "@/lib/server/treasury-rules";
import type { TreasuryRuleRow } from "@/lib/treasury/types";

type RouteContext = { params: Promise<{ clientId: string; ruleId: string }> };

type PatchBody = {
  active?: boolean;
  name?: string;
  match_merchant?: string;
  match_type?: "exact" | "contains" | "fuzzy";
  amount_min?: number | null;
  amount_max?: number | null;
  direction?: "in" | "out" | null;
  assign_label?: string;
  cadence?: string | null;
  /** When true, re-run apply for this rule without other field changes. */
  reapply?: boolean;
};

const MATCH_CONDITION_KEYS = [
  "match_merchant",
  "match_type",
  "amount_min",
  "amount_max",
  "direction",
] as const;

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const body = (await request.json()) as PatchBody;

  if (body.reapply) {
    const suggested = await applyRulesForClient(guard.admin, clientId, ruleId);
    const { data: rule } = await guard.admin
      .from("treasury_rules")
      .select("*")
      .eq("id", ruleId)
      .eq("client_user_id", clientId)
      .maybeSingle();
    return NextResponse.json({ rule, suggested });
  }

  const { data: before } = await guard.admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  const update: Database["public"]["Tables"]["treasury_rules"]["Update"] = {};
  if (body.active !== undefined) update.active = body.active;
  if (body.name !== undefined) update.name = body.name;
  if (body.match_merchant !== undefined) update.match_merchant = body.match_merchant;
  if (body.match_type !== undefined) update.match_type = body.match_type;
  if (body.amount_min !== undefined) update.amount_min = body.amount_min;
  if (body.amount_max !== undefined) update.amount_max = body.amount_max;
  if (body.direction !== undefined) update.direction = body.direction;
  if (body.assign_label !== undefined) update.assign_label = body.assign_label;
  if (body.cadence !== undefined) update.cadence = body.cadence;

  const conditionsChanged = MATCH_CONDITION_KEYS.some((k) => {
    if (body[k] === undefined || !before) return false;
    const prev = before[k];
    const next = body[k];
    return String(prev ?? "") !== String(next ?? "");
  });

  const { data: rule, error } = await guard.admin
    .from("treasury_rules")
    .update(update)
    .eq("id", ruleId)
    .eq("client_user_id", clientId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Spec 63 Part E — narrowing must prune orphan suggestions (apply only upserts).
  const suggested = conditionsChanged
    ? await reconcileRuleSuggestions(
        guard.admin,
        clientId,
        rule as TreasuryRuleRow
      )
    : await applyRulesForClient(guard.admin, clientId, ruleId);

  return NextResponse.json({ rule, suggested });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  await guard.admin
    .from("treasury_transaction_suggestions")
    .delete()
    .eq("client_user_id", clientId)
    .eq("rule_id", ruleId);

  await guard.admin
    .from("treasury_transactions")
    .update({
      suggested_label: null,
      suggestion_status: null,
      suggestion_explanation: null,
    })
    .eq("client_user_id", clientId)
    .eq("suggested_by_rule_id", ruleId)
    .eq("suggestion_status", "suggested");

  const { error } = await guard.admin
    .from("treasury_rules")
    .delete()
    .eq("id", ruleId)
    .eq("client_user_id", clientId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
