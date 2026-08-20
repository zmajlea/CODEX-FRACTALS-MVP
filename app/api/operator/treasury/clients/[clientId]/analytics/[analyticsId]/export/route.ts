import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  assembleAnalyticsBoard,
  normalizeBoardRow,
} from "@/lib/treasury/analytics-assemble";
import {
  htmlToPdfBuffer,
  renderAnalyticsBoardHtml,
} from "@/lib/treasury/analytics-pdf";

type RouteContext = {
  params: Promise<{ clientId: string; analyticsId: string }>;
};

/** Spec B7 — branded PDF from the same assemble path as GET board. */
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const board = normalizeBoardRow(data as Record<string, unknown>);
    const assembled = await assembleAnalyticsBoard(guard.admin, board);
    const html = renderAnalyticsBoardHtml(assembled);
    const pdf = await htmlToPdfBuffer(html);
    const filename = `${board.title.replace(/[^\w\-]+/g, "_").slice(0, 48) || "analytics"}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
