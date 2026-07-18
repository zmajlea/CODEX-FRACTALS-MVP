import { NextResponse } from "next/server";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  assertTransactionsBelongToClient,
  buildRuleContextTxQueryParams,
  currentRuleContextN,
  evidenceAsJson,
  evidenceFromPickable,
  findOrCreateOpenDraft,
  hasRuleContextCompanion,
  normalizeRecommendationRow,
  resolveEvidenceLive,
  tryAppendEvidenceItem,
  tryAppendTransactionEvidence,
} from "@/lib/server/treasury-recommendation-evidence";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import { assertAbsolutePickParams } from "@/lib/treasury/pickable";

type RouteContext = { params: Promise<{ clientId: string }> };

type PostBody = {
  transaction_ids?: string[];
  /** Spec 40 — which open draft receives the pick */
  draft_kind?: DraftKind;
  /** Spec 40 — portable pick (recipes + refs) */
  pickable?: Pickable;
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

  const draftKind: DraftKind =
    body.draft_kind === "question" ? "question" : "recommendation";

  const { draft, created, error: createErr } = await findOrCreateOpenDraft(
    guard.admin,
    {
      clientUserId: clientId,
      operatorId: guard.user.id,
      tenantId: guard.grant.tenantId,
      kind: draftKind,
    }
  );
  if (createErr) {
    return NextResponse.json({ error: createErr }, { status: 500 });
  }

  let nextEvidence = draft.evidence;
  let auditKind = "transaction";
  let auditDetail: Record<string, unknown> = {};
  let duplicate = false;

  if (body.pickable) {
    try {
      assertAbsolutePickParams(body.pickable.params);
      const item = evidenceFromPickable(body.pickable);
      // transaction[] bulk still uses transaction_ids; single transaction pick uses ref
      if (item.kind === "transaction") {
        const owned = await assertTransactionsBelongToClient(
          guard.admin,
          clientId,
          [item.id]
        );
        if (!owned.ok) {
          return NextResponse.json(
            { error: "Transactions not found for client", missing: owned.missing },
            { status: 400 }
          );
        }
      }
      const appended = tryAppendEvidenceItem(draft.evidence, item);
      nextEvidence = appended.evidence;
      duplicate = Boolean(appended?.duplicate);
      auditKind = item.kind;
      auditDetail = {
        pickable_kind: body.pickable.kind,
        params: body.pickable.params ?? null,
        ref: body.pickable.ref ?? null,
      };

      // Spec 44 — question + rule → companion txquery (ilike “like this rule”)
      if (
        !duplicate &&
        draftKind === "question" &&
        item.kind === "rule" &&
        !hasRuleContextCompanion(nextEvidence, item.id)
      ) {
        const { data: ruleRow } = await guard.admin
          .from("treasury_rules")
          .select("id, match_merchant, amount_min, amount_max, direction")
          .eq("id", item.id)
          .eq("client_user_id", clientId)
          .maybeSingle();
        if (ruleRow) {
          const n = currentRuleContextN(nextEvidence);
          const companion = evidenceFromPickable({
            kind: "txquery",
            label: `Recent ${n} transactions like this rule — for context.`,
            params: buildRuleContextTxQueryParams(
              {
                id: ruleRow.id,
                match_merchant: ruleRow.match_merchant,
                amount_min: ruleRow.amount_min,
                amount_max: ruleRow.amount_max,
                direction:
                  ruleRow.direction === "in" || ruleRow.direction === "out"
                    ? ruleRow.direction
                    : null,
              },
              n
            ),
          });
          nextEvidence = tryAppendEvidenceItem(nextEvidence, companion).evidence;
          auditDetail = {
            ...auditDetail,
            rule_context_companion: true,
            rule_context_n: n,
          };
        }
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid pickable" },
        { status: 400 }
      );
    }
  } else {
    const transactionIds = (body.transaction_ids ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    if (transactionIds.length === 0) {
      return NextResponse.json(
        { error: "pickable or transaction_ids required" },
        { status: 400 }
      );
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

    const appended = tryAppendTransactionEvidence(draft.evidence, transactionIds);
    nextEvidence = appended.evidence;
    duplicate = Boolean(appended?.duplicate);
    auditDetail = { transaction_ids: transactionIds };
  }

  if (duplicate) {
    const { items, missingCount } = await resolveEvidenceLive(
      guard.admin,
      clientId,
      draft.evidence
    );
    return NextResponse.json({
      draft,
      items,
      missingCount,
      duplicate: true,
    });
  }

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
      draft_kind: draftKind,
      evidence_kind: auditKind,
      evidence_count: row.evidence.length,
      draft_created: created,
      surface: "pick",
      ...auditDetail,
    },
  });

  return NextResponse.json({
    draft: row,
    items,
    missingCount,
    duplicate: false,
  });
}
