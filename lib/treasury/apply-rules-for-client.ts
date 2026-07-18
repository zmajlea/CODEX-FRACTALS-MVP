import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import { normalizeMerchant } from "@/lib/treasury/normalize";
import {
  detectCadence,
  merchantMatches,
  type CadenceDetection,
} from "@/lib/treasury/rule-helpers";
import type { TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

const UPDATE_CONCURRENCY = 15;

function formatRuleAmountBound(n: number | null | undefined): string {
  if (n == null) return "∞";
  return formatTreasuryMoney(n, "USD");
}

function buildRuleSuggestionExplanation(
  rule: TreasuryRuleRow,
  tx: {
    normalized_merchant: string | null;
    amount: number;
    direction: string | null;
  },
  cadenceLabel: string
): string {
  const parts = [
    `matched '${rule.assign_label}'`,
    `merchant ~ ${tx.normalized_merchant ?? rule.match_merchant}`,
  ];
  if (rule.amount_min != null || rule.amount_max != null) {
    parts.push(
      `${formatRuleAmountBound(rule.amount_min ?? 0)}–${formatRuleAmountBound(rule.amount_max)}`
    );
  }
  if (rule.direction) parts.push(rule.direction);
  if (cadenceLabel !== "irregular") parts.push(cadenceLabel);
  return parts.join(", ");
}

async function precomputeCadenceByRule(
  admin: AdminClient,
  clientUserId: string,
  rules: TreasuryRuleRow[]
): Promise<Map<string, CadenceDetection>> {
  const cadenceByRule = new Map<string, CadenceDetection>();

  for (const rule of rules) {
    const { data: matchedDates } = await admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientUserId)
      .ilike("normalized_merchant", `%${rule.match_merchant}%`)
      .eq("is_removed", false)
      .not("posted_date", "is", null)
      .order("posted_date", { ascending: false })
      .limit(24);

    cadenceByRule.set(
      rule.id,
      detectCadence((matchedDates ?? []).map((d) => d.posted_date as string))
    );
  }

  return cadenceByRule;
}

async function applyPendingUpdates(
  admin: AdminClient,
  pending: Array<{
    txId: string;
    update: {
      suggested_label: string;
      suggested_by_rule_id: string;
      suggestion_status: "suggested";
      suggestion_explanation: string;
    };
  }>
): Promise<number> {
  let applied = 0;

  for (let i = 0; i < pending.length; i += UPDATE_CONCURRENCY) {
    const chunk = pending.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(({ txId, update }) =>
        admin
          .from("treasury_transactions")
          .update(update)
          .eq("id", txId)
          .is("label", null)
          .select("id")
      )
    );

    for (const result of results) {
      if (result.error) throw result.error;
      applied += result.data?.length ?? 0;
    }
  }

  return applied;
}

export async function applyRulesForClient(
  admin: AdminClient,
  clientUserId: string,
  ruleId?: string
): Promise<number> {
  let rulesQuery = admin
    .from("treasury_rules")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (ruleId) {
    rulesQuery = rulesQuery.eq("id", ruleId);
  }

  const { data: rules, error: rulesErr } = await rulesQuery;
  if (rulesErr) throw rulesErr;
  if (!rules?.length) return 0;

  const typedRules = rules as TreasuryRuleRow[];
  const ruleIds = typedRules.map((r) => r.id);

  const txs = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("*")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .is("label", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const { data: rejections } = await admin
    .from("treasury_rule_rejections")
    .select("transaction_id, rule_id")
    .in("rule_id", ruleIds);

  const rejectionSet = new Set(
    (rejections ?? []).map((r) => `${r.transaction_id}:${r.rule_id}`)
  );

  const cadenceByRule = await precomputeCadenceByRule(admin, clientUserId, typedRules);

  const pending: Array<{
    txId: string;
    update: {
      suggested_label: string;
      suggested_by_rule_id: string;
      suggestion_status: "suggested";
      suggestion_explanation: string;
    };
  }> = [];

  for (const tx of txs) {
    const normalized = tx.normalized_merchant ?? normalizeMerchant(tx.raw_name, tx.merchant_name);
    const absAmount = Math.abs(Number(tx.amount));

    for (const rule of typedRules) {
      if (rejectionSet.has(`${tx.id}:${rule.id}`)) continue;
      if (!merchantMatches(normalized, rule)) continue;
      if (rule.direction && tx.direction !== rule.direction) continue;
      if (rule.amount_min != null && absAmount < Number(rule.amount_min)) continue;
      if (rule.amount_max != null && absAmount > Number(rule.amount_max)) continue;

      const cadence = cadenceByRule.get(rule.id)!;
      const explanation = buildRuleSuggestionExplanation(rule, tx, cadence.label);

      pending.push({
        txId: tx.id,
        update: {
          suggested_label: rule.assign_label,
          suggested_by_rule_id: rule.id,
          suggestion_status: "suggested",
          suggestion_explanation: explanation,
        },
      });
      break;
    }
  }

  const applied = await applyPendingUpdates(admin, pending);
  if (applied !== pending.length) {
    console.warn(
      `[apply-rules] ${pending.length - applied} suggestion(s) skipped (label set concurrently?)`
    );
  }

  const now = new Date().toISOString();
  await admin
    .from("treasury_rules")
    .update({ last_applied_at: now })
    .in(
      "id",
      typedRules.map((r) => r.id)
    );

  return applied;
}
