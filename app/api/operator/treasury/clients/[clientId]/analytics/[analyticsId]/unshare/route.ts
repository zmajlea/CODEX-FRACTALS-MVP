import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = {
  params: Promise<{ clientId: string; analyticsId: string }>;
};

/** Spec B7 — unpublish (back to draft). */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId, analyticsId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: before } = await guard.admin
    .from("treasury_analytics")
    .select("id")
    .eq("id", analyticsId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .neq("status", "archived")
    .maybeSingle();

  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await guard.admin
    .from("treasury_analytics")
    .update({
      status: "draft",
      shared_at: null,
      shared_by: null,
    })
    .eq("id", analyticsId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ board: data });
}
