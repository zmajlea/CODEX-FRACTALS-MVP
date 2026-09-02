import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { renderReviewSnapshotHtml } from "@/lib/treasury/review-pdf";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

type RouteContext = {
  params: Promise<{ clientId: string; reviewId: string; version: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { clientId, reviewId, version: versionStr } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const version = parseInt(versionStr, 10);
  if (!Number.isFinite(version) || version < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const { data: review } = await guard.admin
    .from("treasury_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (!review) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const autoPrint = url.searchParams.get("print") === "1";

  const { data: row, error } = await guard.admin
    .from("treasury_review_versions")
    .select("snapshot")
    .eq("review_id", reviewId)
    .eq("version", version)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const html = renderReviewSnapshotHtml(row.snapshot as unknown as ReviewSnapshot, {
    autoPrint,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
