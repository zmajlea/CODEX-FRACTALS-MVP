import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type PatchBody = {
  transactionIds?: string[];
  label?: string;
  description?: string;
  confirmSuggestions?: boolean;
};

const MAX_BULK = 200;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = (body.transactionIds ?? []).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: "transactionIds required" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json({ error: `Maximum ${MAX_BULK} transactions per request` }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (body.confirmSuggestions) {
    const { data: txs, error: loadErr } = await guard.admin
      .from("treasury_transactions")
      .select("id, suggested_label, suggestion_status")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .in("id", ids);

    if (loadErr) {
      return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
    }

    const toConfirm = (txs ?? []).filter(
      (t) => t.suggestion_status === "suggested" && t.suggested_label
    );

    if (toConfirm.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    const confirmUpdate: Database["public"]["Tables"]["treasury_transactions"]["Update"] = {
      label_source: "rule_confirmed",
      labeled_by: guard.user.id,
      labeled_at: now,
      suggested_label: null,
      suggested_by_rule_id: null,
      suggestion_status: "confirmed",
      suggestion_explanation: null,
    };

    let updated = 0;
    for (const tx of toConfirm) {
      const { data, error } = await guard.admin
        .from("treasury_transactions")
        .update({ ...confirmUpdate, label: tx.suggested_label })
        .eq("id", tx.id)
        .eq("client_user_id", clientId)
        .select("id");

      if (!error && data?.length) updated += 1;
    }

    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_tx_bulk_labeled",
      payload: {
        client_user_id: clientId,
        action: "confirm_suggestions",
        count: updated,
        transaction_ids: toConfirm.map((t) => t.id),
      },
    });

    return NextResponse.json({ updated });
  }

  const label = body.label?.trim();
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const update: Database["public"]["Tables"]["treasury_transactions"]["Update"] = {
    label,
    description: body.description?.trim() || null,
    label_source: "manual",
    labeled_by: guard.user.id,
    labeled_at: now,
    suggested_label: null,
    suggested_by_rule_id: null,
    suggestion_status: null,
    suggestion_explanation: null,
  };

  const { data: updatedRows, error } = await guard.admin
    .from("treasury_transactions")
    .update(update)
    .in("id", ids)
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updated = updatedRows?.length ?? 0;

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_tx_bulk_labeled",
    payload: {
      client_user_id: clientId,
      label,
      count: updated,
      transaction_ids: (updatedRows ?? []).map((r) => r.id),
    },
  });

  return NextResponse.json({ updated });
}
