import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Spec B7 Part D — list shared boards via **session client** (RLS boundary).
 * Do NOT use admin here.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS: status='shared' AND client_user_id = auth.uid()
  const { data, error } = await supabase
    .from("treasury_analytics")
    .select("id, title, description, shared_at, status, updated_at")
    .order("shared_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ boards: data ?? [] });
}
