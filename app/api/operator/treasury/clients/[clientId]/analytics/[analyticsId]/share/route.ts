import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = {
  params: Promise<{ clientId: string; analyticsId: string }>;
};

/** Spec B7 — publish gate. */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId, analyticsId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: before } = await guard.admin
    .from("treasury_analytics")
    .select("id, status")
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
      status: "shared",
      shared_at: new Date().toISOString(),
      shared_by: guard.user.id,
    })
    .eq("id", analyticsId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ board: data });
}
