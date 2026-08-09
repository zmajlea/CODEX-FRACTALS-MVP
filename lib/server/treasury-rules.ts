import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { querySummary as querySummaryCore } from "@/lib/treasury/query-summary";
import type { SummaryBucket, TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export {
  applyRulesForClient,
  reconcileRuleSuggestions,
} from "@/lib/treasury/apply-rules-for-client";
export { detectCadence, merchantMatches } from "@/lib/treasury/rule-helpers";
export type { CadenceDetection } from "@/lib/treasury/rule-helpers";

export type RuleQueueCounts = {
  suggested: number;
  confirmed: number;
};

/**
 * Spec 58 / 67 B1: suggested = suggestions joined to still-unlabelled txs;
 * confirmed = label_source=rule_confirmed by suggested_by_rule_id.
 * One RPC — no fetch-all.
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

  const { data, error } = await admin.rpc("treasury_rule_queue_counts", {
    p_client: clientUserId,
  });
  if (error) {
    console.error("[countRuleQueues]", error);
    return counts;
  }

  const rows = (data ?? []) as Array<{
    rule_id: string;
    suggested: number;
    confirmed: number;
  }>;
  for (const row of rows) {
    if (!counts.has(row.rule_id)) continue;
    counts.set(row.rule_id, {
      suggested: row.suggested ?? 0,
      confirmed: row.confirmed ?? 0,
    });
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
