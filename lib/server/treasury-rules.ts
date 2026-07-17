import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { querySummary as querySummaryCore } from "@/lib/treasury/query-summary";
import { merchantMatches } from "@/lib/treasury/rule-helpers";
import { normalizeMerchant } from "@/lib/treasury/normalize";
import type { SummaryBucket, TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export { applyRulesForClient } from "@/lib/treasury/apply-rules-for-client";
export { detectCadence, merchantMatches } from "@/lib/treasury/rule-helpers";
export type { CadenceDetection } from "@/lib/treasury/rule-helpers";

/** Live suggestions + rule-confirmed labels that still match the rule merchant. */
export async function countRuleMatches(
  admin: AdminClient,
  clientUserId: string,
  rules: TreasuryRuleRow[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const rule of rules) counts.set(rule.id, 0);

  const { data: live } = await admin
    .from("treasury_transactions")
    .select("suggested_by_rule_id")
    .eq("client_user_id", clientUserId)
    .not("suggested_by_rule_id", "is", null);

  for (const row of live ?? []) {
    const ruleId = row.suggested_by_rule_id;
    if (ruleId) {
      counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
    }
  }

  const { data: confirmed } = await admin
    .from("treasury_transactions")
    .select("normalized_merchant, raw_name, merchant_name, label, label_source")
    .eq("client_user_id", clientUserId)
    .eq("label_source", "rule_confirmed");

  for (const tx of confirmed ?? []) {
    const normalized =
      tx.normalized_merchant ?? normalizeMerchant(tx.raw_name, tx.merchant_name);
    for (const rule of rules) {
      if (tx.label !== rule.assign_label) continue;
      if (!merchantMatches(normalized, rule)) continue;
      counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
      break;
    }
  }

  return counts;
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
