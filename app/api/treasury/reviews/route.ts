import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";

/** Spec B12 — client lists published review issues (session RLS). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: reviews, error } = await supabase
    .from("treasury_reviews")
    .select("id, title, period_month, status, current_version, updated_at")
    .eq("client_user_id", user.id)
    .eq("status", "published")
    .order("period_month", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reviews: reviews ?? [] });
}
