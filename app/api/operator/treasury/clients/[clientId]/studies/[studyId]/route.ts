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
} from "@/lib/treasury/studies";
import type { SpendPlanScenario } from "@/lib/treasury/spend-plan";
import type { Database, Json } from "@/lib/database.types";

type RouteContext = {
  params: Promise<{ clientId: string; studyId: string }>;
};

function validateStudyPayload(
  type: StudyType,
  params: unknown,
  scenarios: unknown,
  derived_snapshot: unknown
): string | null {
  if (type === "spend_plan") return null;
  if (!isCashModelParams(params)) return "Invalid cash_model params";
  if (!isCashModelScenarioArray(scenarios)) return "Invalid cash_model scenarios";
  if (!isCashModelDerivedSnapshot(derived_snapshot)) {
    return "Invalid cash_model derived_snapshot";
  }
  return null;
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

  void writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "analytics",
  });

  return NextResponse.json({ study: asTreasuryStudyRow(data) });
}

type PatchBody = {
  name?: string;
  scope?: StudyScope;
  params?: StudyParams | unknown;
  scenarios?: SpendPlanScenario[] | unknown;
  derived_snapshot?: DerivedSnapshot | unknown;
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

  const { data: existing, error: loadErr } = await guard.admin
    .from("treasury_studies")
    .select("type")
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const studyType = existing.type as StudyType;

  if (
    body.params !== undefined ||
    body.scenarios !== undefined ||
    body.derived_snapshot !== undefined
  ) {
    if (studyType === "cash_model") {
      if (body.params !== undefined && !isCashModelParams(body.params)) {
        return NextResponse.json({ error: "Invalid cash_model params" }, { status: 400 });
      }
      if (body.scenarios !== undefined && !isCashModelScenarioArray(body.scenarios)) {
        return NextResponse.json({ error: "Invalid cash_model scenarios" }, { status: 400 });
      }
      if (
        body.derived_snapshot !== undefined &&
        !isCashModelDerivedSnapshot(body.derived_snapshot)
      ) {
        return NextResponse.json(
          { error: "Invalid cash_model derived_snapshot" },
          { status: 400 }
        );
      }
    }
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
    void writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_study_saved",
      payload: {
        client_user_id: clientId,
        study_id: studyId,
        name: data.name,
      },
    });
  }

  return NextResponse.json({ study: asTreasuryStudyRow(data) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, studyId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: existing } = await guard.admin
    .from("treasury_studies")
    .select("is_primary, type")
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (existing?.is_primary && existing.type === "cash_model") {
    return NextResponse.json(
      { error: "Cannot delete the primary cash model study" },
      { status: 400 }
    );
  }

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

  void writeTreasuryAudit(guard.admin, {
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
