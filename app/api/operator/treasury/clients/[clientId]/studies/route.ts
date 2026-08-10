import { NextResponse } from "next/server";
import {
  writeOperatorTreasuryReadAudit,
  writeTreasuryAudit,
} from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { asTreasuryStudyRow } from "@/lib/server/treasury-study-mapper";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  emptyCashModelDerivedSnapshot,
  isCashModelDerivedSnapshot,
  isCashModelParams,
  isCashModelScenarioArray,
} from "@/lib/treasury/cash-model-types";
import type {
  DerivedSnapshot,
  StudyParams,
  StudyScope,
  StudyType,
  TreasuryStudyRow,
} from "@/lib/treasury/studies";
import type { SpendPlanScenario } from "@/lib/treasury/spend-plan";
import type { Database, Json } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string }> };

function validateStudyPayload(
  type: StudyType,
  params: unknown,
  scenarios: unknown,
  derived_snapshot: unknown
): string | null {
  if (type === "spend_plan") {
    return null;
  }
  if (!isCashModelParams(params)) return "Invalid cash_model params";
  if (!isCashModelScenarioArray(scenarios)) return "Invalid cash_model scenarios";
  if (!isCashModelDerivedSnapshot(derived_snapshot)) {
    return "Invalid cash_model derived_snapshot";
  }
  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .select("*")
    .eq("client_user_id", clientId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "analytics",
  });

  return NextResponse.json({
    studies: (data ?? []).map(asTreasuryStudyRow),
  });
}

type PostBody = {
  name?: string;
  type?: StudyType;
  scope?: StudyScope;
  params?: StudyParams | unknown;
  scenarios?: SpendPlanScenario[] | unknown;
  derived_snapshot?: DerivedSnapshot | unknown;
  is_primary?: boolean;
};

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

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!body.scope?.accountId) {
    return NextResponse.json({ error: "scope.accountId required" }, { status: 400 });
  }
  if (!body.params || !body.scenarios || !body.derived_snapshot) {
    return NextResponse.json(
      { error: "params, scenarios, and derived_snapshot required" },
      { status: 400 }
    );
  }

  const studyType: StudyType = body.type ?? "spend_plan";
  if (studyType !== "spend_plan" && studyType !== "cash_model") {
    return NextResponse.json({ error: "Unsupported study type" }, { status: 400 });
  }

  const validationErr = validateStudyPayload(
    studyType,
    body.params,
    body.scenarios,
    body.derived_snapshot
  );
  if (validationErr) {
    return NextResponse.json({ error: validationErr }, { status: 400 });
  }

  const insert: Database["public"]["Tables"]["treasury_studies"]["Insert"] = {
    client_user_id: clientId,
    operator_tenant_id: guard.grant.tenantId,
    created_by: guard.user.id,
    name,
    type: studyType,
    is_primary: body.is_primary ?? false,
    scope: body.scope as unknown as Json,
    params: body.params as unknown as Json,
    scenarios: body.scenarios as unknown as Json,
    derived_snapshot: body.derived_snapshot as unknown as Json,
  };

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_study_saved",
    payload: {
      client_user_id: clientId,
      study_id: data.id,
      name,
      type: studyType,
    },
  });

  return NextResponse.json({ study: asTreasuryStudyRow(data) });
}
