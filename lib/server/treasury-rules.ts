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
 * Spec 36: honest split counts per rule (kills blended matched N).
 * - suggested = suggested_by_rule_id = :id AND suggestion_status = 'suggested'
 * - confirmed = label_source = 'rule_confirmed' AND suggested_by_rule_id = :id
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

  const live = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("suggested_by_rule_id")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("suggestion_status", "suggested")
      .not("suggested_by_rule_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  for (const row of live) {
    const ruleId = row.suggested_by_rule_id;
    if (!ruleId || !counts.has(ruleId)) continue;
    const cur = counts.get(ruleId)!;
    counts.set(ruleId, { ...cur, suggested: cur.suggested + 1 });
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
    const ruleId = tx.suggested_by_rule_id;
    if (!ruleId || !counts.has(ruleId)) continue;
    const cur = counts.get(ruleId)!;
    counts.set(ruleId, { ...cur, confirmed: cur.confirmed + 1 });
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
  const blended = new Map<string, number>();
  for (const [id, q] of queues) {
    blended.set(id, q.suggested + q.confirmed);
  }
  return blended;
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
