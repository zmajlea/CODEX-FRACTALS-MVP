import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { clientUnreadCount } from "@/lib/server/treasury-recommendations";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
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

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("client_user_id", user.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recommendations = (data ?? []) as TreasuryRecommendationRow[];
  let unreadCount = clientUnreadCount(recommendations);

  const url = new URL(request.url);
  if (url.searchParams.get("mark_seen") === "1") {
    const now = new Date().toISOString();
    const toMark = recommendations.filter((r) => r.status === "sent");
    if (toMark.length > 0) {
      await admin
        .from("treasury_recommendations")
        .update({ client_seen_at: now })
        .eq("client_user_id", user.id)
        .eq("status", "sent")
        .in(
          "id",
          toMark.map((r) => r.id)
        );
      unreadCount = 0;
    }
  }

  return NextResponse.json({ recommendations, unreadCount });
}

type PatchBody = {
  mark_seen?: boolean;
  ids?: string[];
};

export async function PATCH(request: Request) {
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

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.mark_seen) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  let query = admin
    .from("treasury_recommendations")
    .update({ client_seen_at: now })
    .eq("client_user_id", user.id)
    .eq("status", "sent");

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    query = query.in("id", body.ids);
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
