import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  actionToStatus,
  canTransition,
  isDeclineReason,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type RouteContext = { params: Promise<{ recId: string }> };

type PatchBody = {
  action?: string;
  decline_reason?: string;
  decline_note?: string;
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

  const current = rec as TreasuryRecommendationRow;
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
    return NextResponse.json({ recommendation: updated });
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
        : "treasury_recommendation_declined",
    payload: {
      client_user_id: user.id,
      recommendation_id: recId,
      from: current.status,
      to: nextStatus as RecommendationStatus,
      ...(action === "decline"
        ? { decline_reason: update.decline_reason, decline_note: update.decline_note }
        : {}),
    },
  });

  return NextResponse.json({ recommendation: updated });
}
