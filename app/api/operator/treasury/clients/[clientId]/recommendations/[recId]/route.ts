import { NextResponse } from "next/server";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  actionToStatus,
  canTransition,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string; recId: string }> };

type PatchBody = {
  action?: string;
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

  const current = rec as TreasuryRecommendationRow;
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
    return NextResponse.json({ recommendation: updated });
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

  return NextResponse.json({ recommendation: updated });
}
