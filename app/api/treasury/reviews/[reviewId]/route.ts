import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

type RouteContext = { params: Promise<{ reviewId: string }> };

/**
 * B26 — client reads live Edition snapshot (session RLS only).
 * Version-first: do not require treasury_reviews.status = published (reopen keeps
 * the frozen Edition visible via treasury_review_versions_client_select).
 * Never-published drafts have no live version → 404.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { reviewId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: live, error: liveErr } = await supabase
    .from("treasury_review_versions")
    .select(
      "id, version, reviewed_as_of, published_at, change_note, snapshot, label, window"
    )
    .eq("review_id", reviewId)
    .is("superseded_at", null)
    .maybeSingle();

  if (liveErr) {
    return NextResponse.json({ error: liveErr.message }, { status: 500 });
  }
  if (!live) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const versionParam = new URL(_request.url).searchParams.get("version");
  let selected = live;
  if (versionParam) {
    const vNum = Number(versionParam);
    if (Number.isFinite(vNum)) {
      const { data: picked } = await supabase
        .from("treasury_review_versions")
        .select(
          "id, version, reviewed_as_of, published_at, change_note, snapshot, label, window"
        )
        .eq("review_id", reviewId)
        .eq("version", vNum)
        .maybeSingle();
      if (picked) selected = picked;
    }
  }

  const { data: history } = await supabase
    .from("treasury_review_versions")
    .select(
      "id, version, reviewed_as_of, published_at, change_note, label, window"
    )
    .eq("review_id", reviewId)
    .order("version", { ascending: false });

  const snap = selected.snapshot as unknown as ReviewSnapshot;
  const meta = snap?.meta;

  return NextResponse.json({
    review: {
      id: reviewId,
      title: meta?.title ?? "Study",
      period_month: meta?.period_month ?? "",
      status: "published",
      current_version: live.version,
      client_user_id: user.id,
    },
    current: {
      ...selected,
      snapshot: snap,
    },
    /** Spec B19 — Editions (latest first). */
    editions: history ?? [],
    history: history ?? [],
  });
}
