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
  isCashModelDerivedSnapshot,
  isCashModelParams,
  isCashModelScenarioArray,
} from "@/lib/treasury/cash-model-types";
import {
  formatZodIssues,
  parseManualStudyResults,
  validateSummitArithmetic,
} from "@/lib/mcp/results-schema";
import type {
  DerivedSnapshot,
  StudyParams,
  StudyScope,
  StudyType,
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
  /** Spec B16 — manual Study editor payload (summit.results/v1, KPI-only ok). */
  results?: unknown;
  type_label?: string;
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

  // Spec B16 watch note: external_model manual branch MUST short-circuit
  // before scope.accountId + params/scenarios/derived_snapshot required-fields gate.
  if (body.type === "external_model" || body.results != null) {
    const parsed = parseManualStudyResults(
      body.results ?? {
        headline: name,
        as_of: new Date().toISOString().slice(0, 10),
        export_id: "manual",
        kpis: [],
        scenarios: [],
      }
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid summit.results/v1 payload",
          issues: formatZodIssues(parsed.error),
        },
        { status: 400 }
      );
    }
    const results = {
      ...parsed.data,
      headline: parsed.data.headline || name,
    };
    if (results.scenarios.length > 0) {
      const arith = validateSummitArithmetic(results);
      if (!arith.ok) {
        return NextResponse.json(
          { error: "Arithmetic validation failed", issues: arith.issues },
          { status: 400 }
        );
      }
    }

    const typeLabel = body.type_label?.trim() || null;
    const derivedSnapshot = {
      results: {
        ...results,
        type_label: typeLabel,
      },
      validationReport: {
        schemaOk: true,
        arithmeticOk: results.scenarios.length === 0 || true,
        issues: [],
        warnings: [],
      },
      engineBaseline: null,
      submittedAt: new Date().toISOString(),
    };

    const insert: Database["public"]["Tables"]["treasury_studies"]["Insert"] = {
      client_user_id: clientId,
      operator_tenant_id: guard.grant.tenantId,
      created_by: guard.user.id,
      name,
      type: "external_model",
      status: "confirmed",
      source: "manual",
      is_primary: false,
      scope: {
        accountId: body.scope?.accountId ?? "manual",
        label: typeLabel,
      } as unknown as Json,
      params: { type_label: typeLabel } as unknown as Json,
      scenarios: [] as unknown as Json,
      derived_snapshot: derivedSnapshot as unknown as Json,
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
        type: "external_model",
        source: "manual",
      },
    });

    return NextResponse.json({ study: asTreasuryStudyRow(data) });
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
