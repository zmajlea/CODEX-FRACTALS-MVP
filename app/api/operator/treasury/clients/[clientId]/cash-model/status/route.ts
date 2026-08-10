import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { asTreasuryStudyRow } from "@/lib/server/treasury-study-mapper";
import type { CashModelStudyRow } from "@/lib/treasury/studies";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Lightweight portfolio chip — reads saved primary study snapshot only. */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .select("*")
    .eq("client_user_id", clientId)
    .eq("type", "cash_model")
    .eq("is_primary", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ status: null });
  }

  const study = asTreasuryStudyRow(data) as CashModelStudyRow;
  const runwayStatus = study.derived_snapshot?.runwayStatus ?? null;

  return NextResponse.json({
    status: runwayStatus,
    asOf: study.derived_snapshot?.asOf ?? null,
    coveragePct: study.derived_snapshot?.coveragePct ?? null,
  });
}
