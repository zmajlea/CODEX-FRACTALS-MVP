import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/database.types";
import type { Database } from "@/lib/database.types";
import type { McpAuthContext } from "@/lib/mcp/types";
import {
  formatZodIssues,
  reconcileActualsCheck,
  summitResultsV1Schema,
  validateSummitArithmetic,
  type SummitResultsV1,
  type ValidationReport,
} from "@/lib/mcp/results-schema";
import {
  mcpGetCashModelBaseline,
  mcpGetClient,
  mcpGetMonthlyByCategory,
} from "@/lib/mcp/read-tools";

type AdminClient = SupabaseClient<Database>;

export async function mcpSubmitResults(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string,
  resultsRaw: unknown
): Promise<
  | { ok: true; studyId: string; report: ValidationReport }
  | { ok: false; report: ValidationReport }
> {
  const parsed = summitResultsV1Schema.safeParse(resultsRaw);
  const report: ValidationReport = {
    schemaOk: parsed.success,
    arithmeticOk: false,
    issues: parsed.success ? [] : formatZodIssues(parsed.error),
    warnings: [],
  };

  if (!parsed.success) {
    return { ok: false, report };
  }

  const results: SummitResultsV1 = parsed.data;
  const arith = validateSummitArithmetic(results);
  report.arithmeticOk = arith.ok;
  report.issues.push(...arith.issues);
  if (!arith.ok) {
    return { ok: false, report };
  }

  const clientMeta = await mcpGetClient(admin, auth, clientId);
  const accountId =
    results.account_id ?? clientMeta.primary_account_id ?? "default";

  const ledger = await mcpGetMonthlyByCategory(admin, clientId, accountId);
  report.warnings.push(...reconcileActualsCheck(results.actuals_check, ledger));

  if (clientMeta.data_through && results.as_of) {
    const sync = new Date(String(clientMeta.data_through)).getTime();
    const asOf = new Date(results.as_of.slice(0, 10)).getTime();
    if (asOf < sync - 86400000) {
      report.stale = true;
      report.staleReason = `Results as_of ${results.as_of} is older than client sync ${clientMeta.data_through}.`;
      report.warnings.push(report.staleReason);
    }
  }

  const engineBaseline = await mcpGetCashModelBaseline(
    admin,
    clientId,
    accountId
  );

  const derivedSnapshot = {
    results,
    validationReport: report,
    engineBaseline,
    submittedAt: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("treasury_studies")
    .insert({
      client_user_id: clientId,
      operator_tenant_id: auth.tenantId,
      created_by: auth.operatorUserId,
      name: results.headline.slice(0, 120),
      type: "external_model",
      status: "pending",
      source: "mcp",
      is_primary: false,
      scope: { accountId, label: null } as unknown as Json,
      params: {} as Json,
      scenarios: [] as unknown as Json,
      derived_snapshot: derivedSnapshot as unknown as Json,
    })
    .select("id")
    .single();

  if (error || !data) {
    report.issues.push({
      path: "(store)",
      message: error?.message ?? "Failed to store study",
    });
    return { ok: false, report };
  }

  return { ok: true, studyId: data.id, report };
}

const REC_CATEGORIES = new Set(["liquidity", "cost", "financing", "risk"]);

function mapRecommendationKind(kind?: string): "recommendation" | "question" {
  const k = (kind ?? "recommendation").trim().toLowerCase();
  if (k === "question") return "question";
  // advice → recommendation (DB only allows recommendation|question)
  return "recommendation";
}

function mapRecommendationCategory(category?: string): string {
  const c = (category ?? "liquidity").trim().toLowerCase();
  if (REC_CATEGORIES.has(c)) return c;
  throw new Error(
    `category must be one of: liquidity, cost, financing, risk (got "${category}")`
  );
}

export async function mcpProposeRecommendation(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string,
  body: {
    kind?: string;
    title: string;
    body: string;
    category?: string;
  }
) {
  const title = body.title.trim();
  const why = body.body.trim();
  if (!title || !why) throw new Error("title and body required");
  const category = mapRecommendationCategory(body.category);
  const kind = mapRecommendationKind(body.kind);

  const { data, error } = await admin
    .from("treasury_recommendations")
    .insert({
      client_user_id: clientId,
      operator_tenant_id: auth.tenantId,
      created_by: auth.operatorUserId,
      title,
      category,
      why,
      kind,
      status: "draft",
      source: "mcp",
      anchor_type: "general",
    })
    .select("id, title, status, kind, source")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function mcpProposeRule(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string,
  body: {
    name: string;
    payee_contains: string;
    category: string;
    direction?: "in" | "out";
    min_amount?: number;
    max_amount?: number;
  }
) {
  const name = body.name.trim();
  const payee = body.payee_contains.trim();
  const category = body.category.trim();
  if (!name || !payee || !category) {
    throw new Error("name, payee_contains, and category are required");
  }

  const { data, error } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: auth.operatorUserId,
      name,
      match_merchant: payee,
      match_type: "contains",
      assign_label: category,
      direction: body.direction ?? null,
      amount_min: body.min_amount ?? null,
      amount_max: body.max_amount ?? null,
      active: false,
      status: "proposed",
      source: "mcp",
    })
    .select("id, status, source")
    .single();

  if (error) throw new Error(error.message);
  return {
    rule_id: data.id,
    status: "proposed" as const,
    message: "pending operator validation",
  };
}

export async function mcpDefineMetric(
  admin: AdminClient,
  auth: McpAuthContext,
  input: {
    scope: "general" | "client";
    name: string;
    description: string;
    definition: unknown;
    clientId?: string;
  }
) {
  const { createMetric } = await import("@/lib/treasury/metrics-define");
  return createMetric(admin, {
    tenantId: auth.tenantId,
    operatorUserId: auth.operatorUserId,
    scope: input.scope,
    clientId: input.clientId ?? null,
    name: input.name,
    description: input.description,
    definition: input.definition,
    source: "mcp",
  });
}
