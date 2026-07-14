import { NextResponse } from "next/server";
import { canAccessModule } from "@/lib/auth/rbac";
import { disconnectTreasurySource } from "@/lib/server/treasury-disconnect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

type RouteContext = { params: Promise<{ sourceId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { sourceId } = await context.params;
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
  const result = await disconnectTreasurySource(admin, user.id, sourceId);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
