import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  assembleAnalyticsBoard,
  normalizeBoardRow,
} from "@/lib/treasury/analytics-assemble";
import { renderAnalyticsBoardHtml } from "@/lib/treasury/analytics-pdf";

type RouteContext = {
  params: Promise<{ clientId: string; analyticsId: string }>;
};

/**
 * Spec B8 Path C — print-ready HTML (same assemble as GET board).
 * Operator opens this tab and uses browser "Save as PDF". No serverless Chromium.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId, analyticsId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data } = await guard.admin
    .from("treasury_analytics")
    .select("*")
    .eq("id", analyticsId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .neq("status", "archived")
    .maybeSingle();

  if (!data) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const board = normalizeBoardRow(data as Record<string, unknown>);
    const assembled = await assembleAnalyticsBoard(guard.admin, board);
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
