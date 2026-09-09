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
  /** Spec B17 M2 — page arrangement sibling persisted on derived_snapshot.composite. */
  composite?: unknown;
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
    // B17 M2: persist page arrangement as sibling of results (round-trip).
    const { parseStudyPageComposite } = await import(
      "@/lib/treasury/study-page-composite"
    );
    const composite = parseStudyPageComposite(body.composite) ?? undefined;
    const derivedSnapshot = {
      results: {
        ...results,
        type_label: typeLabel,
      },
      ...(composite ? { composite } : {}),
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

  const studyTypeRaw = body.type ?? "spend_plan";
  const { isRegisteredModelType, getModelKind } = await import(
    "@/lib/treasury/model-kinds"
  );
  if (!isRegisteredModelType(studyTypeRaw)) {
    return NextResponse.json(
      { error: "Unsupported study type — not a registered model kind" },
      { status: 400 }
    );
  }
  const studyType = studyTypeRaw;

  // Phase 2 engine kinds — validate via kind.params; server-compute derived+confidence.
  if (
    studyType === "forecast" ||
    studyType === "seasonality" ||
    (studyType === "cash_model" && body.derived_snapshot == null)
  ) {
    const kind = getModelKind(studyType)!;
    const parsed = kind.params.safeParse(body.params ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid params", issues: formatZodIssues(parsed.error) },
        { status: 400 }
      );
    }
    let scenarios: unknown[] = [];
    if (kind.scenarios) {
      const s = kind.scenarios.safeParse(body.scenarios ?? []);
      if (!s.success) {
        return NextResponse.json(
          { error: "Invalid scenarios", issues: formatZodIssues(s.error) },
          { status: 400 }
        );
      }
      scenarios = (s.data as unknown[]) ?? [];
    }

    // Studio cash_model: Floor required when scenarios empty (never invent threshold).
    if (studyType === "cash_model") {
      const { coerceCashModelScenarios, coerceCashModelParams } = await import(
        "@/lib/treasury/model-kinds/cash_model"
      );
      if (!coerceCashModelParams(parsed.data)) {
        return NextResponse.json(
          { error: "Invalid cash_model params — horizon required" },
          { status: 400 }
        );
      }
      if (!coerceCashModelScenarios(parsed.data, scenarios)) {
        return NextResponse.json(
          {
            error:
              "minCashThreshold (Floor) required when scenarios are empty",
          },
          { status: 400 }
        );
      }
    }

    const { loadInputs } = await import(
      "@/lib/treasury/model-kinds/load-inputs"
    );
    const accountId =
      studyType === "cash_model"
        ? String(
            (parsed.data as { accountId?: string }).accountId ??
              body.scope?.accountId ??
              "__all__"
          )
        : (body.scope?.accountId ?? "__all__");
    const scope = { accountId };
    const row = {
      id: "save",
      name,
      type: studyType,
      status: "confirmed" as const,
      params: parsed.data,
      scenarios,
      scope,
      derived_snapshot: null,
    };
    const inputs = await loadInputs(
      guard.admin,
      clientId,
      scope,
      kind.inputs
    );
    const result = kind.compute(inputs, parsed.data, scenarios as never, row);
    if (result == null) {
      return NextResponse.json(
        { error: "Compute returned null — check params and ledger inputs" },
        { status: 400 }
      );
    }
    const confidence = kind.confidence(inputs, parsed.data, result);
    const snapshot = kind.toSnapshot(
      row,
      inputs,
      parsed.data,
      scenarios as never,
      result
    );
    const derivedSnapshot =
      studyType === "cash_model"
        ? {
            ...(kind.derived
              ? kind.derived(result, inputs, parsed.data)
              : { asOf: inputs.cashModel?.asOf ?? "" }),
            confidence,
            assumptions: snapshot.assumptions,
            method_note: snapshot.method_note,
          }
        : {
            ...(kind.derived
              ? kind.derived(result, inputs, parsed.data)
              : { asOf: inputs.cashModel?.asOf ?? "" }),
            confidence,
          };

    // Persist coerced cash params/scenarios (RPC parity), not Studio-only keys alone.
    let storeParams: unknown = parsed.data;
    let storeScenarios: unknown = scenarios;
    if (studyType === "cash_model") {
      const { coerceCashModelParams, coerceCashModelScenarios } = await import(
        "@/lib/treasury/model-kinds/cash_model"
      );
      storeParams = coerceCashModelParams(parsed.data);
      storeScenarios = coerceCashModelScenarios(parsed.data, scenarios);

      const { upsertPrimaryCashModel } = await import(
        "@/lib/server/upsert-primary-cash-model"
      );
      const upserted = await upsertPrimaryCashModel(guard.admin, {
        clientUserId: clientId,
        tenantId: guard.grant.tenantId,
        actorUserId: guard.user.id,
        name,
        scope: {
          accountId,
          label: body.scope?.label ?? null,
        },
        params: storeParams,
        scenarios: storeScenarios,
        derived_snapshot: derivedSnapshot,
      });
      if (!upserted.ok) {
        return NextResponse.json({ error: upserted.error }, { status: 500 });
      }

      void writeTreasuryAudit(guard.admin, {
        actorUserId: guard.user.id,
        eventType: "treasury_study_saved",
        payload: {
          client_user_id: clientId,
          study_id: upserted.row.id,
          name,
          type: studyType,
          upsert: !upserted.created,
        },
      });

      return NextResponse.json({
        study: asTreasuryStudyRow(
          upserted.row as Database["public"]["Tables"]["treasury_studies"]["Row"]
        ),
      });
    }

    const insert: Database["public"]["Tables"]["treasury_studies"]["Insert"] = {
      client_user_id: clientId,
      operator_tenant_id: guard.grant.tenantId,
      created_by: guard.user.id,
      name,
      type: studyType,
      status: "confirmed",
      source: "operator",
      is_primary: body.is_primary ?? false,
      scope: {
        accountId,
        label: body.scope?.label ?? null,
      } as unknown as Json,
      params: storeParams as unknown as Json,
      scenarios: storeScenarios as unknown as Json,
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
        type: studyType,
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
