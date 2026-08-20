import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  computeMetricValue,
  findMetricForClient,
} from "@/lib/treasury/metrics-eval";

type RouteContext = {
  params: Promise<{ clientId: string; metricId: string }>;
};

/** Spec B4 — recompute + persist; client-or-null ownership. */
export async function POST(_request: Request, context: RouteContext) {
  const { clientId, metricId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const metric = await findMetricForClient(
    guard.admin,
    guard.grant.tenantId,
    clientId,
    metricId
  );
  if (!metric) {
    return NextResponse.json({ error: "Metric not found" }, { status: 404 });
  }

  const ledgerClientId = metric.client_user_id ?? clientId;
  try {
    const out = await computeMetricValue(guard.admin, {
      id: metric.id,
      tenant_id: metric.tenant_id,
      client_user_id: ledgerClientId,
      definition: metric.definition as Json,
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
