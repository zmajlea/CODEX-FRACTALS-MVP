import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { querySummary as querySummaryCore } from "@/lib/treasury/query-summary";
import type { SummaryBucket, TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export { applyRulesForClient } from "@/lib/treasury/apply-rules-for-client";
export { detectCadence, merchantMatches } from "@/lib/treasury/rule-helpers";
export type { CadenceDetection } from "@/lib/treasury/rule-helpers";

export type RuleQueueCounts = {
  suggested: number;
  confirmed: number;
};

/**
 * Spec 58: suggested = rows in treasury_transaction_suggestions for this rule
 * (belt: join txs with label IS null). Confirmed unchanged on tx attribution.
 */
export async function countRuleQueues(
  admin: AdminClient,
  clientUserId: string,
  rules: TreasuryRuleRow[]
): Promise<Map<string, RuleQueueCounts>> {
  const counts = new Map<string, RuleQueueCounts>();
  for (const rule of rules) {
    counts.set(rule.id, { suggested: 0, confirmed: 0 });
  }
  if (rules.length === 0) return counts;

  const ruleIdSet = new Set(rules.map((r) => r.id));

  const suggestions = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transaction_suggestions")
      .select("rule_id, transaction_id")
      .eq("client_user_id", clientUserId)
      .in("rule_id", [...ruleIdSet])
      .order("transaction_id", { ascending: true })
      .range(from, to)
  );

  // Belt: only count suggestions whose tx is still unlabelled
  const txIds = [...new Set(suggestions.map((s) => s.transaction_id))];
  const unlabelled = new Set<string>();
  for (let i = 0; i < txIds.length; i += 200) {
    const chunk = txIds.slice(i, i + 200);
    const { data } = await admin
      .from("treasury_transactions")
      .select("id")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .is("label", null)
      .in("id", chunk);
    for (const t of data ?? []) unlabelled.add(t.id);
  }

  for (const row of suggestions) {
    if (!unlabelled.has(row.transaction_id)) continue;
    if (!counts.has(row.rule_id)) continue;
    const cur = counts.get(row.rule_id)!;
    counts.set(row.rule_id, { ...cur, suggested: cur.suggested + 1 });
  }

  const confirmed = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("suggested_by_rule_id")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("label_source", "rule_confirmed")
      .not("suggested_by_rule_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  for (const tx of confirmed) {
    const rid = tx.suggested_by_rule_id;
    if (!rid || !counts.has(rid)) continue;
    const cur = counts.get(rid)!;
    counts.set(rid, { ...cur, confirmed: cur.confirmed + 1 });
  }

  return counts;
}

/** @deprecated Spec 36 — prefer countRuleQueues */
export async function countRuleMatches(
  admin: AdminClient,
  clientUserId: string,
  rules: TreasuryRuleRow[]
): Promise<Map<string, number>> {
  const queues = await countRuleQueues(admin, clientUserId, rules);
  const out = new Map<string, number>();
  for (const [id, q] of queues) {
    out.set(id, q.suggested + q.confirmed);
  }
  return out;
}

export async function querySummary(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    bucket: SummaryBucket;
    from?: string;
    to?: string;
    accountId?: string;
  }
) {
  return querySummaryCore(admin, clientUserId, opts);
}
