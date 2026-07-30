/**
 * Spec 63 — shared rule match descriptor. Preview counts and apply fetch
 * both go through treasury_rule_match_count / treasury_rule_match_page RPCs
 * so they can never disagree.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";

type AdminClient = SupabaseClient<Database>;

export type RuleMatchType = "contains" | "exact" | "fuzzy";

export type RuleMatch = {
  payeeQuery: string;
  matchType?: RuleMatchType | string | null;
  direction?: "in" | "out" | null;
  amount_min?: number | null;
  amount_max?: number | null;
  /** When set, exclude txs rejected for this rule */
  ruleId?: string | null;
};

export type RulePayeePeriodStat = {
  period: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
};

export type RulePayeeStats = {
  total: number;
  will_suggest: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  stddev: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  by_month: RulePayeePeriodStat[];
  by_week: RulePayeePeriodStat[];
  points_per_period: {
    basis: "active" | string;
    avg_per_active_month: number | null;
    avg_per_active_week: number | null;
  };
};

function normalizeMatchType(t: string | null | undefined): string {
  const v = (t ?? "contains").toLowerCase().trim();
  if (v === "exact" || v === "fuzzy" || v === "contains") return v;
  return "contains";
}

function rpcArgs(match: RuleMatch, labelNullOnly: boolean) {
  const dir =
    match.direction === "in" || match.direction === "out"
      ? match.direction
      : null;
  return {
    p_client: "" as string, // filled by caller
    p_payee_query: match.payeeQuery.trim(),
    p_match_type: normalizeMatchType(match.matchType),
    p_direction: dir,
    p_amount_min:
      match.amount_min != null && Number.isFinite(Number(match.amount_min))
        ? Number(match.amount_min)
        : null,
    p_amount_max:
      match.amount_max != null && Number.isFinite(Number(match.amount_max))
        ? Number(match.amount_max)
        : null,
    p_label_null_only: labelNullOnly,
    p_exclude_rejected_for_rule: match.ruleId ?? null,
  };
}

export async function countRuleMatches(
  admin: AdminClient,
  clientUserId: string,
  match: RuleMatch,
  opts?: { labelNullOnly?: boolean }
): Promise<number> {
  const args = rpcArgs(match, opts?.labelNullOnly ?? false);
  args.p_client = clientUserId;
  const { data, error } = await admin.rpc("treasury_rule_match_count", args);
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function fetchRuleMatchPage(
  admin: AdminClient,
  clientUserId: string,
  match: RuleMatch,
  opts?: {
    labelNullOnly?: boolean;
    offset?: number;
    limit?: number;
  }
): Promise<TreasuryTransactionRow[]> {
  const base = rpcArgs(match, opts?.labelNullOnly ?? false);
  const { data, error } = await admin.rpc("treasury_rule_match_page", {
    ...base,
    p_client: clientUserId,
    p_offset: opts?.offset ?? 0,
    p_limit: opts?.limit ?? 200,
  });
  if (error) throw error;
  return (data ?? []) as TreasuryTransactionRow[];
}

/** Page through all matching unlabeled txs for apply (no .in id arrays). */
export async function fetchAllRuleMatches(
  admin: AdminClient,
  clientUserId: string,
  match: RuleMatch,
  opts?: { labelNullOnly?: boolean }
): Promise<TreasuryTransactionRow[]> {
  const out: TreasuryTransactionRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const batch = await fetchRuleMatchPage(admin, clientUserId, match, {
      labelNullOnly: opts?.labelNullOnly ?? true,
      offset,
      limit: pageSize,
    });
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

export async function fetchRulePayeeStats(
  admin: AdminClient,
  clientUserId: string,
  payeeQuery: string,
  opts?: { direction?: "in" | "out" | null; matchType?: string | null }
): Promise<RulePayeeStats> {
  const dir =
    opts?.direction === "in" || opts?.direction === "out"
      ? opts.direction
      : null;
  const { data, error } = await admin.rpc("treasury_rule_payee_stats", {
    p_client: clientUserId,
    p_payee_query: payeeQuery.trim(),
    p_direction: dir,
    p_match_type: normalizeMatchType(opts?.matchType),
  });
  if (error) throw error;
  return data as RulePayeeStats;
}

export function formatRuleConstraintSummary(opts: {
  direction?: "in" | "out" | null;
  amount_min?: number | null;
  amount_max?: number | null;
}): string | null {
  const parts: string[] = [];
  if (opts.direction === "in") parts.push("money in");
  if (opts.direction === "out") parts.push("money out");
  if (opts.amount_min != null || opts.amount_max != null) {
    const lo =
      opts.amount_min != null ? Number(opts.amount_min).toFixed(2) : "…";
    const hi =
      opts.amount_max != null ? Number(opts.amount_max).toFixed(2) : "…";
    parts.push(`amount ${lo}–${hi}`);
  }
  if (parts.length === 0) return null;
  return `Also limited to: ${parts.join(" · ")}`;
}
