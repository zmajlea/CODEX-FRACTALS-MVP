import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { renderReviewSnapshotHtml } from "@/lib/treasury/review-pdf";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

type RouteContext = { params: Promise<{ reviewId: string }> };

/**
 * B26 — client print/export from frozen live Edition (session RLS).
 * Version-first — do not gate on treasury_reviews.status.
 */
export async function GET(request: Request, context: RouteContext) {
  const { reviewId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const autoPrint = url.searchParams.get("print") === "1";

  const { data: version, error } = await supabase
    .from("treasury_review_versions")
    .select("snapshot")
    .eq("review_id", reviewId)
    .is("superseded_at", null)
    .maybeSingle();

  if (error || !version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const html = renderReviewSnapshotHtml(
    version.snapshot as unknown as ReviewSnapshot,
    { autoPrint }
  );

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
