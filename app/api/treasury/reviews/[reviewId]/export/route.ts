import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { renderReviewSnapshotHtml } from "@/lib/treasury/review-pdf";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

type RouteContext = { params: Promise<{ reviewId: string }> };

/** Spec B12 — client print/export from frozen snapshot (session RLS). */
export async function GET(request: Request, context: RouteContext) {
  const { reviewId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: review } = await supabase
    .from("treasury_reviews")
    .select("id, client_user_id")
    .eq("id", reviewId)
    .eq("client_user_id", user.id)
    .maybeSingle();

  if (!review) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
