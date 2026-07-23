import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string; txId: string }> };

type PatchBody = {
  label?: string;
  description?: string;
  confirmSuggestion?: boolean;
  rejectSuggestion?: boolean;
  /** Spec 58 — which rule's suggestion to confirm/reject */
  ruleId?: string;
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

  if (body.rejectSuggestion) {
    if (!body.ruleId) {
      return NextResponse.json(
        { error: "ruleId required to reject a suggestion" },
        { status: 400 }
      );
    }
    await guard.admin.from("treasury_rule_rejections").upsert({
      transaction_id: txId,
      rule_id: body.ruleId,
      rejected_by: guard.user.id,
    });
    await guard.admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("transaction_id", txId)
      .eq("rule_id", body.ruleId);
    // Other suggestions stay; has_pending_suggestion syncs via trigger
  } else if (body.confirmSuggestion) {
    if (!body.ruleId) {
      return NextResponse.json(
        { error: "ruleId required to confirm a suggestion" },
        { status: 400 }
      );
    }
    const { data: sug, error: sugErr } = await guard.admin
      .from("treasury_transaction_suggestions")
      .select("suggested_label, rule_id")
      .eq("transaction_id", txId)
      .eq("rule_id", body.ruleId)
      .maybeSingle();
    if (sugErr || !sug) {
      return NextResponse.json(
        { error: "Suggestion not found" },
        { status: 404 }
      );
    }
    update.label = sug.suggested_label;
    update.label_source = "rule_confirmed";
    update.labeled_by = guard.user.id;
    update.labeled_at = now;
    update.suggested_by_rule_id = sug.rule_id;
    update.suggestion_status = "confirmed";
    update.suggested_label = null;
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

  if (Object.keys(update).length > 0) {
    const { data: updated, error } = await guard.admin
      .from("treasury_transactions")
      .update(update)
      .eq("id", txId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (body.confirmSuggestion || body.label !== undefined) {
      await guard.admin
        .from("treasury_transaction_suggestions")
        .delete()
        .eq("transaction_id", txId);
    }

    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_tx_labeled",
      payload: {
        client_user_id: clientId,
        transaction_id: txId,
        label: updated.label,
        rule_id: body.ruleId ?? null,
        action: body.confirmSuggestion
          ? "confirm"
          : body.rejectSuggestion
            ? "reject"
            : "manual",
      },
    });

    return NextResponse.json({ transaction: updated });
  }

  // Reject-only path: no tx column update required
  if (body.rejectSuggestion) {
    const { data: refreshed } = await guard.admin
      .from("treasury_transactions")
      .select("*")
      .eq("id", txId)
      .single();
    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_tx_labeled",
      payload: {
        client_user_id: clientId,
        transaction_id: txId,
        rule_id: body.ruleId,
        action: "reject",
      },
    });
    return NextResponse.json({ transaction: refreshed });
  }

  return NextResponse.json({ error: "No changes" }, { status: 400 });
}
