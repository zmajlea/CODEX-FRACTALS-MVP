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

    let txIdsFilter: string[] | null = null;
    if (!body.confirmAllSuggested) {
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
      txIdsFilter = ids;
    }

    const { data, error } = await guard.admin.rpc(
      "treasury_confirm_rule_suggestions",
      {
        p_client: clientId,
        p_rule: ruleId,
        p_actor: guard.user.id,
        p_transaction_ids: txIdsFilter,
      }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = (data ?? {}) as {
      confirmed?: number;
      transaction_ids?: string[];
    };
    const updated = result.confirmed ?? 0;
    const confirmedIds = result.transaction_ids ?? [];

    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_tx_bulk_labeled",
      payload: {
        client_user_id: clientId,
        action: "confirm_suggestions",
        rule_id: ruleId,
        count: updated,
        transaction_ids: confirmedIds,
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
