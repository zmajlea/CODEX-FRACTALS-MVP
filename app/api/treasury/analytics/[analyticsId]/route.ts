import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assembleAnalyticsBoard,
  normalizeBoardRow,
  sanitizeAssembledForClient,
} from "@/lib/treasury/analytics-assemble";

type RouteContext = { params: Promise<{ analyticsId: string }> };

/**
 * Spec B7 Part D (security):
 * 1) Load board with authenticated session client → RLS is the boundary.
 * 2) Assert board.client_user_id === auth.uid() before compute.
 * 3) Return computed envelopes only (never ledger rows).
 */
export async function GET(_request: Request, context: RouteContext) {
  const { analyticsId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Session client — RLS enforces shared + auth.uid()
  const { data: row, error } = await supabase
    .from("treasury_analytics")
    .select("*")
    .eq("id", analyticsId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const board = normalizeBoardRow(row as Record<string, unknown>);

  // Defense-in-depth ownership assert before any compute
  if (board.client_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (board.status !== "shared") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const assembled = await assembleAnalyticsBoard(admin, board);
    return NextResponse.json(sanitizeAssembledForClient(assembled));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
