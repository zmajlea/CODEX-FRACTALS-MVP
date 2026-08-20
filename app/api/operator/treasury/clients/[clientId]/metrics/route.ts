import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Spec B3 — list metrics for client + tenant-general. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_metrics")
    .select(
      "id, name, description, scope, source, status, computed_value, computed_at, definition, created_at"
    )
    .eq("tenant_id", guard.grant.tenantId)
    .eq("status", "active")
    .or(`client_user_id.eq.${clientId},client_user_id.is.null`)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ metrics: data ?? [] });
}
