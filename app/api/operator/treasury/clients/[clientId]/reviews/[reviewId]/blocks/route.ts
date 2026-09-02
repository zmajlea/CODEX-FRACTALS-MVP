import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  computeBlockMetric,
  normalizeBlockRow,
  normalizeReviewRow,
  toPlacedSnapshot,
} from "@/lib/treasury/review-assemble";
import { scanEnvelope } from "@/lib/treasury/envelope-scan";
import type { Json } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string; reviewId: string }> };

import type { OperatorTreasuryContext } from "@/lib/server/operator-treasury-route";

async function loadDraftReview(
  guard: OperatorTreasuryContext,
  clientId: string,
  reviewId: string
) {
  const { data } = await guard.admin
    .from("treasury_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft")
    .maybeSingle();
  return data ? normalizeReviewRow(data as Record<string, unknown>) : null;
}

/** Spec B12 — add block or reorder blocks. */
export async function POST(request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const review = await loadDraftReview(guard, clientId, reviewId);
  if (!review) {
    return NextResponse.json({ error: "Draft review not found" }, { status: 404 });
  }

  let body: {
    role?: string;
    metric_id?: string;
    recommendation_id?: string;
    caption?: string;
    body?: string;
    title?: string;
    kind?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const role = body.role?.trim();
  if (!role || !["figure", "exhibit", "note", "narrative"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { data: maxPos } = await guard.admin
    .from("treasury_review_blocks")
    .select("position")
    .eq("review_id", reviewId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxPos?.position ?? 0) + 1;
  let recommendationId = body.recommendation_id?.trim() || null;
  let metricId = body.metric_id?.trim() || null;
  let caption = body.caption?.trim() ?? "";
  let noteBody = body.body?.trim() ?? "";

  if (role === "narrative") {
    if (!recommendationId) {
      const kind = body.kind === "question" ? "question" : "recommendation";
      const title = body.title?.trim() || (kind === "question" ? "Question" : "Recommendation");
      const why = noteBody || caption || " ";
      const { data: rec, error: recErr } = await guard.admin
        .from("treasury_recommendations")
        .insert({
          client_user_id: clientId,
          operator_tenant_id: guard.grant.tenantId,
          created_by: guard.user.id,
          title,
          category: kind === "question" ? "liquidity" : "liquidity",
          why,
          kind,
          status: "draft",
          anchor_type: "general",
        })
        .select("id")
        .single();
      if (recErr || !rec) {
        return NextResponse.json({ error: recErr?.message ?? "Rec create failed" }, { status: 500 });
      }
      recommendationId = rec.id;
    }
    metricId = null;
  } else if (role === "note") {
    if (scanEnvelope(noteBody).length || scanEnvelope(caption).length) {
      return NextResponse.json({ error: "Envelope violation in note text" }, { status: 422 });
    }
    recommendationId = null;
    metricId = null;
  } else {
    if (!metricId) {
      return NextResponse.json({ error: "metric_id required" }, { status: 400 });
    }
    recommendationId = null;
  }

  let placedSnapshot: Json | null = null;
  if (metricId && (role === "figure" || role === "exhibit")) {
    const blockStub = normalizeBlockRow({
      id: "",
      review_id: reviewId,
      position,
      role,
      metric_id: metricId,
      recommendation_id: null,
      pinned_window: null,
      placed_snapshot: null,
      caption,
      body: "",
      proposal_state: "none",
      provenance: {},
      created_at: "",
      updated_at: "",
    });
    const out = await computeBlockMetric(
      guard.admin,
      review.tenant_id,
      review.client_user_id,
      blockStub
    );
    if (out) placedSnapshot = toPlacedSnapshot(out);
  }

  const { data: block, error } = await guard.admin
    .from("treasury_review_blocks")
    .insert({
      review_id: reviewId,
      position,
      role,
      metric_id: metricId,
      recommendation_id: recommendationId,
      caption,
      body: noteBody,
      placed_snapshot: placedSnapshot,
      proposal_state: "none",
      provenance: { author: "operator" },
    })
    .select("*")
    .single();

  if (error || !block) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  return NextResponse.json(
    { block: normalizeBlockRow(block as Record<string, unknown>) },
    { status: 201 }
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const review = await loadDraftReview(guard, clientId, reviewId);
  if (!review) {
    return NextResponse.json({ error: "Draft review not found" }, { status: 404 });
  }

  let body: { order?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const order = body.order;
  if (!Array.isArray(order) || !order.length) {
    return NextResponse.json({ error: "order required" }, { status: 400 });
  }

  for (let i = 0; i < order.length; i++) {
    await guard.admin
      .from("treasury_review_blocks")
      .update({ position: i + 1 })
      .eq("id", order[i]!)
      .eq("review_id", reviewId);
  }

  return NextResponse.json({ ok: true });
}
