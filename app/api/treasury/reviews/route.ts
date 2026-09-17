import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

/**
 * B26 — client lists Studies that have a live Edition (session RLS only).
 * Resolve via treasury_review_versions (superseded_at IS NULL); do not gate on
 * treasury_reviews.status (reopened drafts stay visible with their frozen Edition).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: versions, error } = await supabase
    .from("treasury_review_versions")
    .select("review_id, version, published_at, snapshot")
    .is("superseded_at", null)
    .order("published_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reviews = (versions ?? []).map((v) => {
    const snap = v.snapshot as unknown as ReviewSnapshot | null;
    const meta = snap?.meta;
    return {
      id: v.review_id,
      title: meta?.title ?? "Study",
      period_month: meta?.period_month ?? "",
      /** Client-facing: live Edition present ⇒ published envelope. */
      status: "published",
      current_version: v.version,
      updated_at: v.published_at,
    };
  });

  return NextResponse.json({ reviews });
}
