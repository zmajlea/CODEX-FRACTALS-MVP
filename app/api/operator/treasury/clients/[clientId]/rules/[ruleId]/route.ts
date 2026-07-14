import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { applyRulesForClient } from "@/lib/server/treasury-rules";

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
};

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const body = (await request.json()) as PatchBody;
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

  await applyRulesForClient(guard.admin, clientId, ruleId);
  return NextResponse.json({ rule });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, ruleId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

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
