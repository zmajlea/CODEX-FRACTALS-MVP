import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = {
  params: Promise<{ clientId: string; metricId: string }>;
};

/** Spec B3 — soft-delete (discard) a metric. */
export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, metricId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: before } = await guard.admin
    .from("treasury_metrics")
    .select("id, tenant_id")
    .eq("id", metricId)
    .eq("tenant_id", guard.grant.tenantId)
    .maybeSingle();

  if (!before) {
    return NextResponse.json({ error: "Metric not found" }, { status: 404 });
  }

  const { error } = await guard.admin
    .from("treasury_metrics")
    .update({ status: "discarded" })
    .eq("id", metricId)
    .eq("tenant_id", guard.grant.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
