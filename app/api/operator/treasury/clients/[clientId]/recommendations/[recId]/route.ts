import { NextResponse } from "next/server";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  actionToStatus,
  canTransition,
  isImpactBasis,
  isRecommendationCategory,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import {
  evidenceAsJson,
  normalizeRecommendationRow,
  parseEvidence,
  removeEvidenceItem,
  resolveEvidenceLive,
  snapshotEvidenceAtSeal,
} from "@/lib/server/treasury-recommendation-evidence";
import type { Database } from "@/lib/database.types";
import type { RecommendationEvidence } from "@/lib/treasury/types";

type RouteContext = { params: Promise<{ clientId: string; recId: string }> };

type PatchBody = {
  action?: string;
  title?: string;
  category?: string;
  why?: string;
  impact_amount?: number | null;
  impact_unit?: string | null;
  impact_basis?: string | null;
  evidence_kind?: RecommendationEvidence["kind"];
  evidence_id?: string;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, recId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action?.trim();
  if (!action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const { data: rec, error: loadErr } = await guard.admin
    .from("treasury_recommendations")
    .select("*")
    .eq("id", recId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (loadErr || !rec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const current = normalizeRecommendationRow(rec as Record<string, unknown>);
  const now = new Date().toISOString();

  if (action === "mark_seen") {
    const { data: updated, error } = await guard.admin
      .from("treasury_recommendations")
      .update({ operator_seen_at: now })
      .eq("id", recId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      recommendation: normalizeRecommendationRow(updated as Record<string, unknown>),
    });
  }

  if (
    action === "remove_evidence" ||
    action === "clear_evidence" ||
    action === "update_draft"
  ) {
    if (current.status !== "draft") {
      return NextResponse.json({ error: "Only drafts can be edited" }, { status: 409 });
    }
    if (current.created_by !== guard.user.id) {
      return NextResponse.json({ error: "Not your draft" }, { status: 403 });
    }

    let evidence = current.evidence;
    const update: Database["public"]["Tables"]["treasury_recommendations"]["Update"] = {};

    if (action === "remove_evidence") {
      const kind = body.evidence_kind ?? "transaction";
      const id = body.evidence_id?.trim();
      if (!id) {
        return NextResponse.json({ error: "evidence_id required" }, { status: 400 });
      }
      evidence = removeEvidenceItem(evidence, kind, id);
      update.evidence = evidenceAsJson(evidence);
    } else if (action === "clear_evidence") {
      evidence = [];
      update.evidence = evidenceAsJson([]);
    } else {
      if (body.title !== undefined) update.title = body.title;
      if (body.why !== undefined) update.why = body.why;
      if (body.category !== undefined) {
        if (!isRecommendationCategory(body.category)) {
          return NextResponse.json({ error: "Invalid category" }, { status: 400 });
        }
        update.category = body.category;
      }
      if (body.impact_amount !== undefined) {
        update.impact_amount = body.impact_amount;
      }
      if (body.impact_unit !== undefined) {
        update.impact_unit = body.impact_unit?.trim() || null;
      }
      if (body.impact_basis !== undefined) {
        if (
          body.impact_basis != null &&
          body.impact_basis !== "" &&
          !isImpactBasis(body.impact_basis)
        ) {
          return NextResponse.json({ error: "Invalid impact basis" }, { status: 400 });
        }
        update.impact_basis = body.impact_basis
          ? (body.impact_basis as "per_month" | "per_year" | "one_time")
          : null;
      }
    }

    const { data: updated, error } = await guard.admin
      .from("treasury_recommendations")
      .update(update)
      .eq("id", recId)
      .select("*")
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message ?? "Update failed" },
        { status: 500 }
      );
    }

    const row = normalizeRecommendationRow(updated as Record<string, unknown>);
    const { items, missingCount } = await resolveEvidenceLive(
      guard.admin,
      clientId,
      row.evidence
    );

    return NextResponse.json({ recommendation: row, draft: row, items, missingCount });
  }

  const nextStatus = actionToStatus(action, current.status);
  if (!nextStatus) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!canTransition(current.status, nextStatus, "operator")) {
    return NextResponse.json(
      { error: `Cannot transition from ${current.status} via ${action}` },
      { status: 409 }
    );
  }

  const update: Database["public"]["Tables"]["treasury_recommendations"]["Update"] = {
    status: nextStatus,
  };

  if (action === "send") {
    if (current.created_by !== guard.user.id && current.status === "draft") {
      return NextResponse.json({ error: "Not your draft" }, { status: 403 });
    }

    // Explicit category required on seal — never inherit an unexamined DB placeholder
    if (!body.category || !isRecommendationCategory(body.category)) {
      return NextResponse.json(
        { error: "Category required — choose one before sealing" },
        { status: 400 }
      );
    }
    const title = (body.title ?? current.title).trim();
    const why = (body.why ?? current.why).trim();
    if (!title || !why) {
      return NextResponse.json({ error: "Title and why are required to seal" }, { status: 400 });
    }

    if (body.impact_amount !== undefined) update.impact_amount = body.impact_amount;
    if (body.impact_unit !== undefined) {
      update.impact_unit = body.impact_unit?.trim() || null;
    }
    if (body.impact_basis !== undefined) {
      if (
        body.impact_basis != null &&
        body.impact_basis !== "" &&
        !isImpactBasis(body.impact_basis)
      ) {
        return NextResponse.json({ error: "Invalid impact basis" }, { status: 400 });
      }
      update.impact_basis = body.impact_basis
        ? (body.impact_basis as "per_month" | "per_year" | "one_time")
        : null;
    }

    const snapped = await snapshotEvidenceAtSeal(
      guard.admin,
      clientId,
      parseEvidence(current.evidence)
    );
    update.evidence = evidenceAsJson(snapped);
    update.title = title;
    update.why = why;
    update.category = body.category;
    update.sealed_at = now;
    update.sealed_by = guard.user.id;
    update.sent_at = now;
  }

  const { data: updated, error } = await guard.admin
    .from("treasury_recommendations")
    .update(update)
    .eq("id", recId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (action === "send") {
    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_recommendation_sealed",
      payload: {
        client_user_id: clientId,
        recommendation_id: recId,
        sealed_at: now,
        evidence_count: parseEvidence(
          (updated as { evidence?: unknown }).evidence
        ).length,
      },
    });
  } else {
    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_recommendation_progress",
      payload: {
        client_user_id: clientId,
        recommendation_id: recId,
        from: current.status,
        to: nextStatus as RecommendationStatus,
      },
    });
  }

  return NextResponse.json({
    recommendation: normalizeRecommendationRow(updated as Record<string, unknown>),
  });
}
