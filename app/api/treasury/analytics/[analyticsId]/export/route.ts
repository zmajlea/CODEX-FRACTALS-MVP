import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  assembleAnalyticsBoard,
  normalizeBoardRow,
} from "@/lib/treasury/analytics-assemble";
import { renderAnalyticsBoardHtml } from "@/lib/treasury/analytics-pdf";

type RouteContext = { params: Promise<{ analyticsId: string }> };

/** Spec B10 Part E — client print of a shared board (session RLS load). */
export async function GET(_request: Request, context: RouteContext) {
  const { analyticsId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: row } = await supabase
    .from("treasury_analytics")
    .select("*")
    .eq("id", analyticsId)
    .maybeSingle();

  if (!row) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const board = normalizeBoardRow(row as Record<string, unknown>);
  if (board.client_user_id !== user.id || board.status !== "shared") {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createSupabaseAdminClient();
    const assembled = await assembleAnalyticsBoard(admin, board);
    const html = renderAnalyticsBoardHtml(assembled, { autoPrint: true });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
