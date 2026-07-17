import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";

type PatchBody = {
  transactionIds?: string[];
  label?: string;
  description?: string;
  confirmSuggestions?: boolean;
  /** Confirm every suggested row for this client (paginated). Ignores transactionIds. */
  confirmAllSuggested?: boolean;
};

const MAX_BULK = 500;

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

  const now = new Date().toISOString();

  if (body.confirmAllSuggested || body.confirmSuggestions) {
    let ids = (body.transactionIds ?? []).filter(Boolean);

    if (body.confirmAllSuggested) {
      const rows = await fetchAllRows((from, to) =>
        guard.admin
          .from("treasury_transactions")
          .select("id, suggested_label, suggestion_status")
          .eq("client_user_id", clientId)
          .eq("is_removed", false)
          .eq("suggestion_status", "suggested")
          .not("suggested_label", "is", null)
          .order("id", { ascending: true })
          .range(from, to)
      );
      ids = rows.map((r) => r.id);
    }

    if (ids.length === 0) {
      return NextResponse.json(
        body.confirmAllSuggested
          ? { updated: 0 }
          : { error: "transactionIds required" },
        body.confirmAllSuggested ? { status: 200 } : { status: 400 }
      );
    }
    if (!body.confirmAllSuggested && ids.length > MAX_BULK) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BULK} transactions per request` },
        { status: 400 }
      );
    }

    // Chunk .in() queries for large confirm-all sets
    const toConfirm: Array<{ id: string; suggested_label: string | null }> = [];
    for (let i = 0; i < ids.length; i += MAX_BULK) {
      const chunk = ids.slice(i, i + MAX_BULK);
      const { data: txs, error: loadErr } = await guard.admin
        .from("treasury_transactions")
        .select("id, suggested_label, suggestion_status")
        .eq("client_user_id", clientId)
        .eq("is_removed", false)
        .in("id", chunk);

      if (loadErr) {
        return NextResponse.json(
          { error: "Failed to load transactions" },
          { status: 500 }
        );
      }
      for (const t of txs ?? []) {
        if (t.suggestion_status === "suggested" && t.suggested_label) {
          toConfirm.push(t);
        }
      }
    }

    if (toConfirm.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    const confirmUpdate: Database["public"]["Tables"]["treasury_transactions"]["Update"] = {
      label_source: "rule_confirmed",
      labeled_by: guard.user.id,
      labeled_at: now,
      suggested_label: null,
      // Keep suggested_by_rule_id so matched_count handoff holds.
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

  const ids = (body.transactionIds ?? []).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: "transactionIds required" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { error: `Maximum ${MAX_BULK} transactions per request` },
      { status: 400 }
    );
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
