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

type RouteContext = {
  params: Promise<{ clientId: string; studyId: string }>;
};

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
  const { clientId, studyId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .select("*")
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "analytics",
  });

  return NextResponse.json({ study: asStudy(data) });
}

type PatchBody = {
  name?: string;
  scope?: StudyScope;
  params?: StudyParams;
  scenarios?: SpendPlanScenario[];
  derived_snapshot?: DerivedSnapshot;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, studyId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Database["public"]["Tables"]["treasury_studies"]["Update"] = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    update.name = name;
  }
  if (body.scope !== undefined) update.scope = body.scope as unknown as Json;
  if (body.params !== undefined) update.params = body.params as unknown as Json;
  if (body.scenarios !== undefined) {
    update.scenarios = body.scenarios as unknown as Json;
  }
  if (body.derived_snapshot !== undefined) {
    update.derived_snapshot = body.derived_snapshot as unknown as Json;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .update(update)
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.params !== undefined || body.scenarios !== undefined || body.derived_snapshot !== undefined) {
    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_study_saved",
      payload: {
        client_user_id: clientId,
        study_id: studyId,
        name: data.name,
      },
    });
  }

  return NextResponse.json({ study: asStudy(data) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, studyId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .delete()
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .select("id, name")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_study_deleted",
    payload: {
      client_user_id: clientId,
      study_id: studyId,
      name: data.name,
    },
  });

  return NextResponse.json({ ok: true });
}
