import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { normalizeReviewRow } from "@/lib/treasury/review-assemble";

type RouteContext = { params: Promise<{ clientId: string }> };

function periodMonthFromDate(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function defaultTitle(d: Date = new Date()): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) +
    " Treasury Review";
}

/** Spec B12 — list reviews + create draft issue. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: reviews, error } = await guard.admin
    .from("treasury_reviews")
    .select("*")
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .neq("status", "archived")
    .order("period_month", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = await Promise.all(
    (reviews ?? []).map(async (r) => {
      const review = normalizeReviewRow(r as Record<string, unknown>);
      const { count: replyCount } = await guard.admin
        .from("treasury_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", clientId)
        .neq("status", "draft")
        .not("client_response", "is", null);
      const { data: currentVersion } = await guard.admin
        .from("treasury_review_versions")
        .select("version, published_at")
        .eq("review_id", review.id)
        .is("superseded_at", null)
        .maybeSingle();
      return {
        ...review,
        current_version_published_at: currentVersion?.published_at ?? null,
        reply_count: replyCount ?? 0,
      };
    })
  );

  return NextResponse.json({ reviews: enriched });
}

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: { period_month?: string; label?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const periodMonth = body.period_month?.trim() || periodMonthFromDate();
  const label = body.label?.trim() ?? "";
  const title = body.title?.trim() || defaultTitle(new Date(periodMonth + "T00:00:00Z"));

  const { data: existing } = await guard.admin
    .from("treasury_reviews")
    .select("id")
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .eq("period_month", periodMonth)
    .eq("label", label)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Issue already exists for this period/label" }, { status: 409 });
  }

  const { data: created, error } = await guard.admin
    .from("treasury_reviews")
    .insert({
      tenant_id: guard.grant.tenantId,
      client_user_id: clientId,
      period_month: periodMonth,
      label,
      title,
      status: "draft",
      created_by: guard.user.id,
    })
    .select("*")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 500 });
  }

  return NextResponse.json(
    { review: normalizeReviewRow(created as Record<string, unknown>) },
    { status: 201 }
  );
}
