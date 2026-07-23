import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  detectCadence,
  merchantMatches,
  type CadenceDetection,
} from "@/lib/treasury/rule-helpers";
import { escapeIlike } from "@/lib/treasury/tx-predicate";
import type { TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

const UPSERT_CHUNK = 200;

type SuggestionInsert = {
  transaction_id: string;
  rule_id: string;
  client_user_id: string;
  suggested_label: string;
  suggestion_explanation: string;
};

function formatRuleAmountBound(n: number | null | undefined): string {
  if (n == null) return "∞";
  return formatTreasuryMoney(n, "USD");
}

/** Rule-level "why this matched" — not per-tx. */
function buildRuleSuggestionExplanation(
  rule: TreasuryRuleRow,
  cadenceLabel: string
): string {
  const parts = [
    `matched '${rule.assign_label}'`,
    `merchant contains '${rule.match_merchant}'`,
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
    const safe = escapeIlike(rule.match_merchant);
    const { data: matchedDates } = await admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientUserId)
      .or(
        `normalized_merchant.ilike.%${safe}%,raw_name.ilike.%${safe}%,merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`
      )
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

async function upsertSuggestions(
  admin: AdminClient,
  rows: SuggestionInsert[]
): Promise<number> {
  if (rows.length === 0) return 0;
  let applied = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await admin
      .from("treasury_transaction_suggestions")
      .upsert(chunk, {
        onConflict: "transaction_id,rule_id",
        ignoreDuplicates: false,
      })
      .select("transaction_id");
    if (error) throw error;
    applied += data?.length ?? chunk.length;
  }
  return applied;
}

/**
 * Spec 58 — fetch uncategorised txs only (label IS null).
 * Confirmed rows are Phase 2. Pending suggestions coexist in the suggestions table.
 */
async function fetchUnlabeledForApply(
  admin: AdminClient,
  clientUserId: string
) {
  return fetchAllRows((from, to) =>
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
}

/**
 * Spec 58 Phase 1 — every matching rule proposes into treasury_transaction_suggestions.
 * No ownership steal; no break after first match. Confirmed (label set) never touched.
 *
 * @returns number of suggestion upserts performed
 */
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

  const txs = await fetchUnlabeledForApply(admin, clientUserId);

  const { data: rejections } = await admin
    .from("treasury_rule_rejections")
    .select("transaction_id, rule_id")
    .in("rule_id", ruleIds);

  const rejectionSet = new Set(
    (rejections ?? []).map((r) => `${r.transaction_id}:${r.rule_id}`)
  );

  const cadenceByRule = await precomputeCadenceByRule(admin, clientUserId, typedRules);

  const pending: SuggestionInsert[] = [];

  for (const tx of txs) {
    const absAmount = Math.abs(Number(tx.amount));

    for (const rule of typedRules) {
      if (rejectionSet.has(`${tx.id}:${rule.id}`)) continue;
      if (
        !merchantMatches(
          {
            normalized_merchant: tx.normalized_merchant,
            raw_name: tx.raw_name,
            merchant_name: tx.merchant_name,
            description: tx.description,
          },
          rule
        )
      )
        continue;
      if (rule.direction && tx.direction !== rule.direction) continue;
      if (rule.amount_min != null && absAmount < Number(rule.amount_min)) continue;
      if (rule.amount_max != null && absAmount > Number(rule.amount_max)) continue;

      const cadence = cadenceByRule.get(rule.id)!;
      const explanation = buildRuleSuggestionExplanation(rule, cadence.label);

      pending.push({
        transaction_id: tx.id,
        rule_id: rule.id,
        client_user_id: clientUserId,
        suggested_label: rule.assign_label,
        suggestion_explanation: explanation,
      });
      // Spec 58: no break — every matching rule proposes
    }
  }

  const applied = await upsertSuggestions(admin, pending);

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
