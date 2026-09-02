import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { clientUnreadCount } from "@/lib/server/treasury-recommendations";
import { normalizeRecommendationRow } from "@/lib/server/treasury-recommendation-evidence";
import { createClient } from "@/utils/supabase/server";

/** Spec B10 — session client + RLS (never admin for client reads). */
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

  const { data, error } = await supabase
    .from("treasury_recommendations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recommendations = (data ?? []).map((row) =>
    normalizeRecommendationRow(row as Record<string, unknown>)
  );
  let unreadCount = clientUnreadCount(recommendations);

  const url = new URL(request.url);
  if (url.searchParams.get("mark_seen") === "1") {
    const now = new Date().toISOString();
    const toMark = recommendations.filter((r) => r.status === "sent");
    if (toMark.length > 0) {
      await supabase
        .from("treasury_recommendations")
        .update({ client_seen_at: now })
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

  const now = new Date().toISOString();
  let query = supabase
    .from("treasury_recommendations")
    .update({ client_seen_at: now })
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

/** Spec B10 Part F — client raises their own question. */
export async function POST(request: Request) {
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

  let body: { title?: string; why?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";
  const why = body.why?.trim() ?? "";
  if (!title || !why) {
    return NextResponse.json(
      { error: "title and why required" },
      { status: 400 }
    );
  }

  const { data: grant } = await supabase
    .from("client_module_access")
    .select("distributor_tenant_id")
    .eq("client_user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("treasury_recommendations")
    .insert({
      client_user_id: user.id,
      operator_tenant_id: grant?.distributor_tenant_id ?? null,
      kind: "question",
      category: "liquidity",
      title,
      why,
      status: "sent",
      sent_at: now,
      source: "client",
      evidence: [] as unknown as import("@/lib/database.types").Json,
      anchor_type: "general",
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      recommendation: normalizeRecommendationRow(
        data as Record<string, unknown>
      ),
    },
    { status: 201 }
  );
}
