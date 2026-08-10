import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { asTreasuryStudyRow } from "@/lib/server/treasury-study-mapper";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  emptyCashModelDerivedSnapshot,
} from "@/lib/treasury/cash-model-types";
import type { Json } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string }> };

type PostBody = {
  accountId?: string;
};

/** Spec 65 — idempotent primary cash_model row per client+account (navigation-safe). */
export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const accountId = body.accountId?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const params = defaultCashModelParams();
  const scenarios = defaultCashModelScenarios();
  const derived_snapshot = emptyCashModelDerivedSnapshot();

  const { data: studyId, error: rpcErr } = await guard.admin.rpc(
    "treasury_ensure_primary_cash_model",
    {
      p_client: clientId,
      p_account: accountId,
      p_tenant: guard.grant.tenantId,
      p_actor: guard.user.id,
      p_name: "Cash model",
      p_scope: { accountId, label: null } as unknown as Json,
      p_params: params as unknown as Json,
      p_scenarios: scenarios as unknown as Json,
      p_derived_snapshot: derived_snapshot as unknown as Json,
    }
  );

  if (rpcErr || !studyId) {
    return NextResponse.json(
      { error: rpcErr?.message ?? "Failed to ensure primary cash model" },
      { status: 500 }
    );
  }

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .select("*")
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Study not found after ensure" },
      { status: 500 }
    );
  }

  return NextResponse.json({ study: asTreasuryStudyRow(data) });
}
