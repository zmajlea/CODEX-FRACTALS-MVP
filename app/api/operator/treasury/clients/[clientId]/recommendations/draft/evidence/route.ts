import { NextResponse } from "next/server";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  appendTransactionEvidence,
  assertTransactionsBelongToClient,
  evidenceAsJson,
  findOrCreateOpenDraft,
  normalizeRecommendationRow,
  resolveEvidenceLive,
} from "@/lib/server/treasury-recommendation-evidence";

type RouteContext = { params: Promise<{ clientId: string }> };

type PostBody = {
  transaction_ids?: string[];
};

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const transactionIds = (body.transaction_ids ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  if (transactionIds.length === 0) {
    return NextResponse.json({ error: "transaction_ids required" }, { status: 400 });
  }

  const owned = await assertTransactionsBelongToClient(
    guard.admin,
    clientId,
    transactionIds
  );
  if (!owned.ok) {
    return NextResponse.json(
      { error: "Transactions not found for client", missing: owned.missing },
      { status: 400 }
    );
  }

  const { draft, created, error: createErr } = await findOrCreateOpenDraft(guard.admin, {
    clientUserId: clientId,
    operatorId: guard.user.id,
    tenantId: guard.grant.tenantId,
  });
  if (createErr) {
    return NextResponse.json({ error: createErr }, { status: 500 });
  }

  const nextEvidence = appendTransactionEvidence(draft.evidence, transactionIds);
  const { data: updated, error } = await guard.admin
    .from("treasury_recommendations")
    .update({ evidence: evidenceAsJson(nextEvidence) })
    .eq("id", draft.id)
    .eq("status", "draft")
    .eq("created_by", guard.user.id)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update evidence" },
      { status: 500 }
    );
  }

  const row = normalizeRecommendationRow(updated as Record<string, unknown>);
  const { items, missingCount } = await resolveEvidenceLive(
    guard.admin,
    clientId,
    row.evidence
  );

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_recommendation_evidence_added",
    payload: {
      client_user_id: clientId,
      recommendation_id: row.id,
      transaction_ids: transactionIds,
      evidence_count: row.evidence.length,
      draft_created: created,
      surface: "transactions",
    },
  });

  return NextResponse.json({ draft: row, items, missingCount });
}
