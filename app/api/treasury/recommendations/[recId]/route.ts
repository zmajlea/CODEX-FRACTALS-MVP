import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import { normalizeRecommendationRow } from "@/lib/server/treasury-recommendation-evidence";
import {
  actionToStatus,
  canTransition,
  isDeclineReason,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type { Database } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type RouteContext = { params: Promise<{ recId: string }> };

type PatchBody = {
  action?: string;
  decline_reason?: string;
  decline_note?: string;
  client_response?: string;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { recId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canAccessModule(supabase, user.id, "treasury");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const admin = createSupabaseAdminClient();
  const { data: rec, error: loadErr } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("id", recId)
    .eq("client_user_id", user.id)
    .maybeSingle();

  if (loadErr || !rec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const current = normalizeRecommendationRow(rec as Record<string, unknown>);
  const now = new Date().toISOString();

  if (action === "mark_seen") {
    const { data: updated, error } = await admin
      .from("treasury_recommendations")
      .update({ client_seen_at: now })
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

  const nextStatus = actionToStatus(action, current.status);
  if (!nextStatus) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!canTransition(current.status, nextStatus, "client")) {
    return NextResponse.json(
      { error: `Cannot transition from ${current.status} via ${action}` },
      { status: 409 }
    );
  }

  // Recommendations: accept/decline. Questions: answer only.
  if (current.kind === "question") {
    if (action !== "answer") {
      return NextResponse.json(
        { error: "Questions are answered, not accepted or declined" },
        { status: 400 }
      );
    }
  } else if (action === "answer") {
    return NextResponse.json(
      { error: "Recommendations use accept or decline" },
      { status: 400 }
    );
  }

  const update: Database["public"]["Tables"]["treasury_recommendations"]["Update"] = {
    status: nextStatus,
    decided_at: now,
  };

  if (action === "decline") {
    const reason = body.decline_reason?.trim();
    if (!reason || !isDeclineReason(reason)) {
      return NextResponse.json({ error: "Valid decline reason required" }, { status: 400 });
    }
    update.decline_reason = reason;
    update.decline_note = body.decline_note?.trim() || null;
  }

  if (action === "answer") {
    const response = body.client_response?.trim() ?? "";
    if (!response) {
      return NextResponse.json({ error: "An answer is required" }, { status: 400 });
    }
    update.client_response = response;
    update.responded_at = now;
    // Clear operator_seen so inbox lights up
    update.operator_seen_at = null;
  }

  const { data: updated, error } = await admin
    .from("treasury_recommendations")
    .update(update)
    .eq("id", recId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeTreasuryAudit(admin, {
    actorUserId: user.id,
    eventType:
      action === "accept"
        ? "treasury_recommendation_accepted"
        : action === "decline"
          ? "treasury_recommendation_declined"
          : "treasury_question_answered",
    payload: {
      client_user_id: user.id,
      recommendation_id: recId,
      kind: current.kind,
      from: current.status,
      to: nextStatus as RecommendationStatus,
      ...(action === "decline"
        ? { decline_reason: update.decline_reason, decline_note: update.decline_note }
        : {}),
      ...(action === "answer" ? { responded_at: now } : {}),
    },
  });

  return NextResponse.json({
    recommendation: normalizeRecommendationRow(updated as Record<string, unknown>),
  });
}
