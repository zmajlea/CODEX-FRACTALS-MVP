import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { applyRulesForClient } from "@/lib/server/treasury-rules";

type RouteContext = { params: Promise<{ clientId: string; txId: string }> };

type PatchBody = {
  label?: string;
  description?: string;
  confirmSuggestion?: boolean;
  rejectSuggestion?: boolean;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, txId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: tx, error: loadErr } = await guard.admin
    .from("treasury_transactions")
    .select("*")
    .eq("id", txId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (loadErr || !tx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const update: Database["public"]["Tables"]["treasury_transactions"]["Update"] = {};

  if (body.rejectSuggestion && tx.suggested_by_rule_id) {
    await guard.admin.from("treasury_rule_rejections").upsert({
      transaction_id: txId,
      rule_id: tx.suggested_by_rule_id,
      rejected_by: guard.user.id,
    });
    update.suggested_label = null;
    update.suggested_by_rule_id = null;
    update.suggestion_status = "rejected";
    update.suggestion_explanation = null;
  } else if (body.confirmSuggestion && tx.suggested_label) {
    update.label = tx.suggested_label;
    update.label_source = "rule_confirmed";
    update.labeled_by = guard.user.id;
    update.labeled_at = now;
    update.suggested_label = null;
    update.suggested_by_rule_id = null;
    update.suggestion_status = "confirmed";
    update.suggestion_explanation = null;
  } else if (body.label !== undefined) {
    update.label = body.label.trim() || null;
    update.description = body.description ?? null;
    update.label_source = body.label ? "manual" : null;
    update.labeled_by = body.label ? guard.user.id : null;
    update.labeled_at = body.label ? now : null;
    update.suggested_label = null;
    update.suggested_by_rule_id = null;
    update.suggestion_status = null;
    update.suggestion_explanation = null;
  }

  const { data: updated, error } = await guard.admin
    .from("treasury_transactions")
    .update(update)
    .eq("id", txId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_tx_labeled",
    payload: {
      client_user_id: clientId,
      transaction_id: txId,
      label: updated.label,
      action: body.confirmSuggestion
        ? "confirm"
        : body.rejectSuggestion
          ? "reject"
          : "manual",
    },
  });

  return NextResponse.json({ transaction: updated });
}
