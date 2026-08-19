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
      return {
        id: clientId,
        name: nameById.get(clientId) ?? "Client",
        data_through: lastSync,
        to_review: count ?? 0,
        coverage: null as number | null,
      };
    })
  );

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function primaryAccountId(
  admin: AdminClient,
  clientId: string
): Promise<string | null> {
  const { data } = await admin
    .from("treasury_accounts")
    .select("id")
    .eq("client_user_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function mcpGetClient(
  admin: AdminClient,
  auth: McpAuthContext,
  clientId: string
) {
  const accountId = await primaryAccountId(admin, clientId);
  if (!accountId) {
    return {
      client_id: clientId,
      accounts: [],
      categories: [],
      rules_summary: [],
      recommendations: [],
      data_through: null,
      opening_balance: null,
    };
  }

  const [accountsRes, labelsRes, rulesRes, recsRes, inputs] = await Promise.all([
    admin
      .from("treasury_accounts")
      .select("id, name, mask, current_balance, iso_currency_code, updated_at")
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

  return {
    client_id: clientId,
    accounts: (accountsRes.data ?? []).map((a) => ({
      id: a.id,
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
    data_through: lastSync,
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
    .select("id, mask")
    .eq("client_user_id", clientId);
  const maskByAccount = new Map(
    (accounts ?? []).map((a) => [a.id, a.mask] as const)
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
  const acct = accountId ?? (await primaryAccountId(admin, clientId));
  if (!acct) return [];
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
  const acct = accountId ?? (await primaryAccountId(admin, clientId));
  if (!acct) return null;
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
3. Model externally in your Claude session; emit summit.results/v1.
4. submit_results — lands as pending; confirm in the operator app.
5. propose_recommendation — draft only, never auto-sent.`;
