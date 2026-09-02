import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { createClient } from "@/utils/supabase/server";

type RouteContext = { params: Promise<{ recId: string }> };

/**
 * Spec B10 Part F — attach a file to a recommendation/question thread.
 * Bytes + metadata via session client + RLS (no admin).
 */
export async function POST(request: Request, context: RouteContext) {
  const { recId } = await context.params;
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

  const { data: rec } = await supabase
    .from("treasury_recommendations")
    .select("id")
    .eq("id", recId)
    .maybeSingle();
  if (!rec) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (10MB max)" }, { status: 400 });
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const path = `${user.id}/${recId}/${Date.now()}_${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from("treasury-thread")
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("treasury_thread_attachments")
    .insert({
      recommendation_id: recId,
      client_user_id: user.id,
      storage_path: path,
      filename: file.name,
      content_type: file.type || null,
      byte_size: file.size,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attachment: data }, { status: 201 });
}

export async function GET(_request: Request, context: RouteContext) {
  const { recId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("treasury_thread_attachments")
    .select("id, filename, content_type, byte_size, created_at, storage_path")
    .eq("recommendation_id", recId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ attachments: data ?? [] });
}
