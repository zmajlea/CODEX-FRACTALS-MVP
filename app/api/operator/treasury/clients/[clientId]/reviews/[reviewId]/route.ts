import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  normalizeBlockRow,
  normalizeReviewRow,
  suggestedCaptionForBlock,
} from "@/lib/treasury/review-assemble";
import {
  computeReviewPreflight,
  preflightBlocked,
} from "@/lib/treasury/review-preflight";
import type { Database } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string; reviewId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: reviewRow, error } = await guard.admin
    .from("treasury_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (error || !reviewRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const review = normalizeReviewRow(reviewRow as Record<string, unknown>);

  const { data: blockRows } = await guard.admin
    .from("treasury_review_blocks")
    .select("*")
    .eq("review_id", reviewId)
    .order("position", { ascending: true });

  const blocks = (blockRows ?? []).map((r) =>
    normalizeBlockRow(r as Record<string, unknown>)
  );

  const preflight = await computeReviewPreflight(guard.admin, reviewId);

  const blocksWithMeta = await Promise.all(
    blocks.map(async (b) => {
      let metricName: string | null = null;
      if (b.metric_id) {
        const { data: m } = await guard.admin
          .from("treasury_metrics")
          .select("name, kind, computed_at")
          .eq("id", b.metric_id)
          .maybeSingle();
        metricName = m?.name ?? null;
      }
      const suggested_caption = await suggestedCaptionForBlock(
        guard.admin,
        review.tenant_id,
        review.client_user_id,
        b
      );
      return { ...b, metric_name: metricName, suggested_caption };
    })
  );

  return NextResponse.json({
    review,
    blocks: blocksWithMeta,
    preflight,
    publish_blocked: preflightBlocked(preflight),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: { title?: string; period_month?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Database["public"]["Tables"]["treasury_reviews"]["Update"] = {};
  if (body.title !== undefined) update.title = body.title.trim();
  if (body.period_month !== undefined) update.period_month = body.period_month.trim();

  const { data, error } = await guard.admin
    .from("treasury_reviews")
    .update(update)
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft")
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 409 });
  }

  return NextResponse.json({ review: normalizeReviewRow(data as Record<string, unknown>) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { error } = await guard.admin
    .from("treasury_reviews")
    .update({ status: "archived" })
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
