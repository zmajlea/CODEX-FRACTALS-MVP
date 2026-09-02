import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { createClient } from "@/utils/supabase/server";

/** Spec B10 Part E — list documents shared with the client (session RLS). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canAccessModule(supabase, user.id, "treasury");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("treasury_client_documents")
    .select("id, title, kind, analytics_id, print_path, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ documents: data ?? [] });
}
