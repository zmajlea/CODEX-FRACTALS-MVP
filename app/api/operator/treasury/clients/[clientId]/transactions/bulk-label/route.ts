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
  /** Confirm every pending suggestion for this rule (paginated). */
  confirmAllSuggested?: boolean;
  /** Spec 58 — required for confirm-all / confirmSuggestions */
  ruleId?: string;
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
    if (!body.ruleId) {
      return NextResponse.json(
        { error: "ruleId required to confirm suggestions" },
        { status: 400 }
      );
    }
    const ruleId = body.ruleId;

    let pairs: Array<{ transaction_id: string; suggested_label: string }> = [];

    if (body.confirmAllSuggested) {
      const rows = await fetchAllRows((from, to) =>
        guard.admin
          .from("treasury_transaction_suggestions")
          .select("transaction_id, suggested_label")
          .eq("client_user_id", clientId)
          .eq("rule_id", ruleId)
          .order("transaction_id", { ascending: true })
          .range(from, to)
      );
      pairs = rows.map((r) => ({
        transaction_id: r.transaction_id,
        suggested_label: r.suggested_label,
      }));
    } else {
      const ids = (body.transactionIds ?? []).filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json(
          { error: "transactionIds required" },
          { status: 400 }
        );
      }
      if (ids.length > MAX_BULK) {
        return NextResponse.json(
          { error: `Maximum ${MAX_BULK} transactions per request` },
          { status: 400 }
        );
      }
      const { data: sugs, error: loadErr } = await guard.admin
        .from("treasury_transaction_suggestions")
        .select("transaction_id, suggested_label")
        .eq("client_user_id", clientId)
        .eq("rule_id", ruleId)
        .in("transaction_id", ids);
      if (loadErr) {
        return NextResponse.json(
          { error: "Failed to load suggestions" },
          { status: 500 }
        );
      }
      pairs = (sugs ?? []).map((r) => ({
        transaction_id: r.transaction_id,
        suggested_label: r.suggested_label,
      }));
    }

    // Only still-unlabelled txs
    const txIds = pairs.map((p) => p.transaction_id);
    const stillOpen = new Set<string>();
    for (let i = 0; i < txIds.length; i += MAX_BULK) {
      const chunk = txIds.slice(i, i + MAX_BULK);
      const { data } = await guard.admin
        .from("treasury_transactions")
        .select("id")
        .eq("client_user_id", clientId)
        .eq("is_removed", false)
        .is("label", null)
        .in("id", chunk);
      for (const t of data ?? []) stillOpen.add(t.id);
    }
    pairs = pairs.filter((p) => stillOpen.has(p.transaction_id));

    if (pairs.length === 0) {
      return NextResponse.json({ updated: 0 });
    }

    let updated = 0;
    for (const pair of pairs) {
      const { data, error } = await guard.admin
        .from("treasury_transactions")
        .update({
          label: pair.suggested_label,
          label_source: "rule_confirmed",
          labeled_by: guard.user.id,
          labeled_at: now,
          suggested_by_rule_id: ruleId,
          suggestion_status: "confirmed",
          suggested_label: null,
          suggestion_explanation: null,
        })
        .eq("id", pair.transaction_id)
        .eq("client_user_id", clientId)
        .is("label", null)
        .select("id");
      if (!error && data?.length) {
        updated += 1;
        await guard.admin
          .from("treasury_transaction_suggestions")
          .delete()
          .eq("transaction_id", pair.transaction_id);
      }
    }

    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_tx_bulk_labeled",
      payload: {
        client_user_id: clientId,
        action: "confirm_suggestions",
        rule_id: ruleId,
        count: updated,
        transaction_ids: pairs.map((p) => p.transaction_id),
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
  if (updated > 0) {
    await guard.admin
      .from("treasury_transaction_suggestions")
      .delete()
      .in(
        "transaction_id",
        (updatedRows ?? []).map((r) => r.id)
      );
  }

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
