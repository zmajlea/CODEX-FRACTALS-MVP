import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

type RouteContext = { params: Promise<{ reviewId: string }> };

/** Spec B12 — client reads current published version snapshot (session RLS only). */
export async function GET(_request: Request, context: RouteContext) {
  const { reviewId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: review, error: revErr } = await supabase
    .from("treasury_reviews")
    .select("id, title, period_month, status, current_version, client_user_id")
    .eq("id", reviewId)
    .eq("client_user_id", user.id)
    .maybeSingle();

  if (revErr || !review) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: version, error: verErr } = await supabase
    .from("treasury_review_versions")
    .select("id, version, reviewed_as_of, published_at, change_note, snapshot")
    .eq("review_id", reviewId)
    .is("superseded_at", null)
    .maybeSingle();

  if (verErr) {
    return NextResponse.json({ error: verErr.message }, { status: 500 });
  }

  const { data: history } = await supabase
    .from("treasury_review_versions")
    .select("id, version, reviewed_as_of, published_at, change_note")
    .eq("review_id", reviewId)
    .order("version", { ascending: false });

  return NextResponse.json({
    review,
    current: version
      ? {
          ...version,
          snapshot: version.snapshot as unknown as ReviewSnapshot,
        }
      : null,
    history: history ?? [],
  });
}
