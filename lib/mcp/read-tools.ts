import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
} from "@/lib/treasury/cash-model-types";
import { computeTreasuryCashModel } from "@/lib/server/treasury-cash-model";
import { loadCashModelInputs } from "@/lib/server/treasury-cash-model";
import { loadMonthlyByCategoryFlat } from "@/lib/treasury/load-monthly-by-category";
import { normalizeRecommendationRow } from "@/lib/server/treasury-recommendation-evidence";
import type { Database } from "@/lib/database.types";
import type { McpAuthContext } from "@/lib/mcp/types";
import type { TxStatusFilter } from "@/lib/treasury/tx-predicate";

type AdminClient = SupabaseClient<Database>;

/** Plaid: positive = outflow. MCP export: positive = money in. */
export function mcpExportAmount(amount: number): number {
  return -amount;
}

export async function mcpListClients(
  admin: AdminClient,
  auth: McpAuthContext
) {
  const { data: mod } = await admin
    .from("modules")
    .select("id")
    .eq("slug", "treasury")
    .maybeSingle();
  if (!mod) return [];

  const { data: grants, error } = await admin
    .from("client_module_access")
    .select("client_user_id, status")
    .eq("distributor_tenant_id", auth.tenantId)
    .eq("module_id", mod.id)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const clientIds = (grants ?? []).map((g) => g.client_user_id);
  if (!clientIds.length) return [];

  const { data: users, error: userErr } = await admin
    .from("users")
    .select("id, email, display_name")
    .in("id", clientIds);
  if (userErr) throw new Error(userErr.message);

  const nameById = new Map(
    (users ?? []).map((u) => [
      u.id,
      u.display_name?.trim() || u.email?.split("@")[0] || "Client",
    ])
  );

  const rows = await Promise.all(
    clientIds.map(async (clientId) => {
      const { count } = await admin
        .from("treasury_transactions")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", clientId)
        .eq("is_removed", false)
        .is("label", null);
      const { data: accts } = await admin
        .from("treasury_accounts")
        .select("updated_at")
        .eq("client_user_id", clientId);
      const lastSync = (accts ?? []).reduce<string | null>((max, a) => {
        const u = a.updated_at;
        if (!u) return max;
        return !max || u > max ? u : max;
      }, null);
      // Fallback data_through from latest posted_date when no account rows
      let dataThrough = lastSync;
      if (!dataThrough) {
        const { data: lastTx } = await admin
          .from("treasury_transactions")
          .select("posted_date")
          .eq("client_user_id", clientId)
          .eq("is_removed", false)
          .order("posted_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        dataThrough = lastTx?.posted_date ?? null;
      }
      return {
        id: clientId,
        name: nameById.get(clientId) ?? "Client",
        data_through: dataThrough,
        to_review: count ?? 0,
        coverage: null as number | null,
      };
    })
  );

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Prefer ledger account_id text; may be null for CSV-only books without account rows. */
async function primaryAccountId(
  admin: AdminClient,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("treasury_accounts")
    .select("account_id")
    .eq("client_user_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.account_id ?? null;
}

export async function mcpGetClient(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string
) {
  const accountId = await primaryAccountId(admin, clientId);

  const [accountsRes, labelsRes, rulesRes, recsRes, inputs] = await Promise.all([
    admin
      .from("treasury_accounts")
      .select("id, name, mask, current_balance, iso_currency_code, updated_at, account_id")
      .eq("client_user_id", clientId),
    admin
      .from("treasury_transactions")
      .select("label")
      .eq("client_user_id", clientId)
      .not("label", "is", null)
      .limit(500),
    admin
      .from("treasury_rules")
      .select("id, name, match_merchant, assign_label, active")
      .eq("client_user_id", clientId)
      .order("updated_at", { ascending: false }),
    admin
      .from("treasury_recommendations")
      .select("*")
      .eq("client_user_id", clientId)
      .order("created_at", { ascending: false }),
    loadCashModelInputs(admin, clientId, accountId),
  ]);

  const categories = [
    ...new Set(
      (labelsRes.data ?? [])
        .map((r) => r.label)
        .filter((l): l is string => Boolean(l))
    ),
  ].sort();

  const lastSync = (accountsRes.data ?? []).reduce<string | null>((max, a) => {
    const u = (a as { updated_at?: string }).updated_at;
    if (!u) return max;
    return !max || u > max ? u : max;
  }, null);

  let dataThrough = lastSync;
  if (!dataThrough) {
    const { data: lastTx } = await admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .order("posted_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    dataThrough = lastTx?.posted_date ?? null;
  }

  return {
    client_id: clientId,
    accounts: (accountsRes.data ?? []).map((a) => ({
      id: a.id,
      account_id: a.account_id,
      name: a.name,
      mask: a.mask,
      balance: a.current_balance,
      currency: a.iso_currency_code,
    })),
    categories,
    rules_summary: (rulesRes.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      payee: r.match_merchant,
      label: r.assign_label,
      enabled: r.active,
    })),
    recommendations: (recsRes.data ?? []).map((r) =>
      normalizeRecommendationRow(r as Record<string, unknown>)
    ),
    data_through: dataThrough,
    opening_balance: inputs.openingBalance,
    primary_account_id: accountId,
  };
}

export async function mcpGetTransactions(
  admin: AdminClient,
  clientId: string,
  opts: { from?: string; to?: string; status?: TxStatusFilter; limit?: number }
) {
  const { data: accounts } = await admin
    .from("treasury_accounts")
    .select("account_id, mask")
    .eq("client_user_id", clientId);
  const maskByAccount = new Map(
    (accounts ?? []).map((a) => [a.account_id, a.mask] as const)
  );

  let q = admin
    .from("treasury_transactions")
    .select(
      "posted_date, account_id, merchant_name, normalized_merchant, raw_name, description, label, amount, direction, suggestion_status"
    )
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .order("posted_date", { ascending: false })
    .limit(Math.min(opts.limit ?? 500, 2000));

  if (opts.from) q = q.gte("posted_date", opts.from);
  if (opts.to) q = q.lte("posted_date", opts.to);
  if (opts.status === "labeled") q = q.not("label", "is", null);
  if (opts.status === "needs_label") q = q.is("label", null);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const dir =
      row.direction ??
      (row.amount <= 0 ? "in" : "out");
    return {
      date: row.posted_date,
      account_mask: maskByAccount.get(row.account_id) ?? null,
      payee: row.merchant_name ?? row.normalized_merchant ?? row.raw_name,
      memo: row.description,
      category: row.label,
      status: row.label ? "labeled" : row.suggestion_status ?? "unlabeled",
      direction: dir,
      amount: mcpExportAmount(Number(row.amount)),
    };
  });
}

export async function mcpGetMonthlyByCategory(
  admin: AdminClient,
  clientId: string,
  accountId?: string
) {
  // Spec B6 — no account required; null = all client accounts
  const acct = accountId?.trim() || null;
  const rows = await loadMonthlyByCategoryFlat(admin, clientId, {
    accountId: acct,
    from: "2000-01-01",
    to: "2099-12-31",
  });
  return rows.map((r) => ({
    month: r.month.slice(0, 7),
    category: r.label === "__uncategorized__" ? "Uncategorized" : r.label,
    inflow: r.direction === "in" ? r.total : 0,
    outflow: r.direction === "out" ? r.total : 0,
    net:
      (r.direction === "in" ? r.total : 0) -
      (r.direction === "out" ? r.total : 0),
  }));
}

export async function mcpGetRules(admin: AdminClient, clientId: string) {
  const { data, error } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function mcpGetRecommendations(admin: AdminClient, clientId: string) {
  const { data, error } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("client_user_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) =>
    normalizeRecommendationRow(r as Record<string, unknown>)
  );
}

export async function mcpGetCashModelBaseline(
  admin: AdminClient,
  clientId: string,
  accountId?: string
) {
  const acct = accountId?.trim() || null;
  const result = await computeTreasuryCashModel(admin, clientId, {
    accountId: acct,
    params: defaultCashModelParams(),
    scenarios: defaultCashModelScenarios(),
  });
  const base = result.summaries.find((s) => s.scenarioId === "base");
  return {
    account_id: acct,
    as_of: result.asOf,
    opening_balance: result.openingBalance,
    breach_month: base?.breachMonth ?? null,
    runway_months: base?.runwayMonths ?? null,
    no_breach_in_horizon: base?.noBreachInHorizon ?? true,
    min_ending: base?.minEnding ?? null,
    coverage_pct: result.coveragePct,
  };
}

export const DESCRIBE_WORKFLOW = `Summit Treasury MCP round-trip:
1. list_clients → pick a client_id you are granted for.
2. get_transactions / get_monthly_by_category / get_rules — read categorized ledger data (amounts: positive = money in).
3. Studies (Spec B16): get_studies → see existing cash_model / external studies.
   Or model externally and submit_results (summit.results/v1) → lands pending → operator confirms in Studies panel → place on issue.
   Manual KPI-only studies can also be authored in the operator Studies panel (confirmed on save).
4. propose_recommendation — draft only, never auto-sent.
5. Review document loop: get_review (includes study blocks) → propose_narrative on captions/notes → operator confirms + publishes.
6. preview_metric — try a grammar definition without persisting (read-only eval).
   Comparison charts (Spec B14): use of:"series_compare" with subdivision + compare block.
   Year-over-year: { of:"series_compare", source:{type:"category",key:"Software",direction:"out"},
     subdivision:"month", bucket_op:"sum", window:{kind:"all"},
     compare:{by:"year",last_n_years:3}, reference_lines:[{id:"avg",label:"3-yr avg",kind:"avg",stat:"avg"}] }
   → MetricComparison v:3 (grouped_column / multi_line). Category compare: compare:{by:"category",keys:["Payroll","Software"]}.`;

export async function mcpGetStudies(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string
) {
  const { data, error } = await admin
    .from("treasury_studies")
    .select("id, name, type, status, source, is_primary, derived_snapshot, updated_at")
    .eq("client_user_id", clientId)
    .eq("operator_tenant_id", auth.tenantId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  return {
    studies: (data ?? []).map((row) => {
      const derived = row.derived_snapshot as Record<string, unknown> | null;
      let as_of: string | null = null;
      let kpis: unknown[] = [];
      if (row.type === "cash_model") {
        as_of = typeof derived?.asOf === "string" ? derived.asOf : null;
        const rs = derived?.runwayStatus as { label?: string } | undefined;
        if (rs?.label) kpis = [{ label: "Status", value: rs.label }];
      } else if (row.type === "external_model") {
        const results = derived?.results as {
          as_of?: string;
          kpis?: unknown[];
        } | undefined;
        as_of = results?.as_of ?? null;
        kpis = results?.kpis ?? [];
      }
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status,
        source: row.source,
        is_primary: row.is_primary,
        as_of,
        kpis,
      };
    }),
  };
}

export async function mcpGetReview(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string,
  reviewId?: string,
  refresh?: boolean
) {
  let q = admin
    .from("treasury_reviews")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (reviewId) {
    q = admin
      .from("treasury_reviews")
      .select("*")
      .eq("id", reviewId)
      .eq("tenant_id", auth.tenantId)
      .eq("client_user_id", clientId);
  }

  const { data: reviewRow, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!reviewRow) throw new Error("Draft review not found");

  const { normalizeBlockRow, normalizeReviewRow, computeBlockMetric, suggestedCaptionForBlock } =
    await import("@/lib/treasury/review-assemble");

  const review = normalizeReviewRow(reviewRow as Record<string, unknown>);
  const { data: blockRows } = await admin
    .from("treasury_review_blocks")
    .select("*")
    .eq("review_id", review.id)
    .order("position", { ascending: true });

  const blocks = await Promise.all(
    (blockRows ?? []).map(async (row) => {
      const block = normalizeBlockRow(row as Record<string, unknown>);
      let computed: unknown = block.placed_snapshot;
      if (refresh && block.metric_id) {
        const out = await computeBlockMetric(
          admin,
          review.tenant_id,
          review.client_user_id,
          block
        );
        computed = out;
      }
      if (refresh && block.role === "study" && block.study_id) {
        const { buildPlacedStudySnapshot } = await import(
          "@/lib/treasury/study-assemble-server"
        );
        const { data: studyRow } = await admin
          .from("treasury_studies")
          .select("*")
          .eq("id", block.study_id)
          .maybeSingle();
        if (studyRow) {
          computed = await buildPlacedStudySnapshot(
            admin,
            clientId,
            studyRow as Record<string, unknown>
          );
        }
      }
      const suggested_caption =
        block.role === "study"
          ? ""
          : await suggestedCaptionForBlock(
              admin,
              review.tenant_id,
              review.client_user_id,
              block
            );
      return {
        id: block.id,
        role: block.role,
        position: block.position,
        metric_id: block.metric_id,
        study_id: block.study_id,
        window: block.pinned_window,
        computed,
        current_caption: block.caption || block.body,
        suggested_caption,
        proposal_state: block.proposal_state,
      };
    })
  );

  const { data: openThreads } = await admin
    .from("treasury_recommendations")
    .select("id, title, kind, status, client_response")
    .eq("client_user_id", clientId)
    .neq("status", "draft")
    .eq("kind", "question")
    .is("client_response", null);

  return {
    review: {
      id: review.id,
      period_month: review.period_month,
      status: review.status,
      version: review.current_version,
    },
    blocks,
    open_threads: openThreads ?? [],
  };
}
