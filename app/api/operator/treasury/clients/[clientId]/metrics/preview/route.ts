import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { previewMetricValue } from "@/lib/treasury/metrics-eval";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Spec B4 — preview a definition against this client's ledger (no write). */
export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: { definition?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.definition === undefined) {
    return NextResponse.json({ error: "definition required" }, { status: 400 });
  }

  const out = await previewMetricValue(
    guard.admin,
    guard.grant.tenantId,
    clientId,
    body.definition
  );

  if (!out.ok) {
    return NextResponse.json({ errors: out.errors }, { status: 400 });
  }

  return NextResponse.json({ value: out.value });
}
