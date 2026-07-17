import { NextResponse } from "next/server";
import {
  writeOperatorTreasuryReadAudit,
  writeTreasuryAudit,
} from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import type {
  DerivedSnapshot,
  StudyParams,
  StudyScope,
  TreasuryStudyRow,
} from "@/lib/treasury/studies";
import type { SpendPlanScenario } from "@/lib/treasury/spend-plan";
import type { Database, Json } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string }> };

function asStudy(row: Database["public"]["Tables"]["treasury_studies"]["Row"]): TreasuryStudyRow {
  return {
    id: row.id,
    client_user_id: row.client_user_id,
    operator_tenant_id: row.operator_tenant_id,
    created_by: row.created_by,
    name: row.name,
    type: row.type as "spend_plan",
    scope: row.scope as StudyScope,
    params: row.params as StudyParams,
    scenarios: row.scenarios as SpendPlanScenario[],
    derived_snapshot: row.derived_snapshot as DerivedSnapshot,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "analytics",
  });

  return NextResponse.json({
    studies: (data ?? []).map(asStudy),
  });
}

type PostBody = {
  name?: string;
  type?: string;
  scope?: StudyScope;
  params?: StudyParams;
  scenarios?: SpendPlanScenario[];
  derived_snapshot?: DerivedSnapshot;
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

  const studyType = body.type ?? "spend_plan";
  if (studyType !== "spend_plan") {
    return NextResponse.json({ error: "Unsupported study type" }, { status: 400 });
  }

  const insert: Database["public"]["Tables"]["treasury_studies"]["Insert"] = {
    client_user_id: clientId,
    operator_tenant_id: guard.grant.tenantId,
    created_by: guard.user.id,
    name,
    type: studyType,
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

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_study_saved",
    payload: {
      client_user_id: clientId,
      study_id: data.id,
      name,
      type: studyType,
    },
  });

  return NextResponse.json({ study: asStudy(data) });
}
