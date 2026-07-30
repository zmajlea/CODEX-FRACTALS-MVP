import type { SupabaseClient } from "@supabase/supabase-js";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  detectCadence,
  type CadenceDetection,
} from "@/lib/treasury/rule-helpers";
import {
  fetchAllRuleMatches,
  fetchRuleMatchPage,
  type RuleMatch,
} from "@/lib/treasury/rule-predicate";
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

function ruleToMatch(rule: TreasuryRuleRow): RuleMatch {
  return {
    payeeQuery: rule.match_merchant,
    matchType: rule.match_type,
    direction: (rule.direction as "in" | "out" | null) ?? null,
    amount_min: rule.amount_min != null ? Number(rule.amount_min) : null,
    amount_max: rule.amount_max != null ? Number(rule.amount_max) : null,
    date_from: rule.date_from ?? null,
    date_to: rule.date_to ?? null,
    ruleId: rule.id,
  };
}

async function precomputeCadenceByRule(
  admin: AdminClient,
  clientUserId: string,
  rules: TreasuryRuleRow[]
): Promise<Map<string, CadenceDetection>> {
  const cadenceByRule = new Map<string, CadenceDetection>();

  for (const rule of rules) {
    const page = await fetchRuleMatchPage(
      admin,
      clientUserId,
      {
        payeeQuery: rule.match_merchant,
        matchType: rule.match_type,
        direction: (rule.direction as "in" | "out" | null) ?? null,
        amount_min: null,
        amount_max: null,
        ruleId: null,
      },
      { labelNullOnly: false, offset: 0, limit: 200 }
    );

    const dates = page
      .map((t) => t.posted_date)
      .filter((d): d is string => Boolean(d))
      .sort()
      .reverse()
      .slice(0, 24);

    cadenceByRule.set(rule.id, detectCadence(dates));
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
 * Spec 63 — delete pending suggestions for this rule that no longer match,
 * then upsert current matches. Confirmed (labelled) rows are never touched.
 */
export async function reconcileRuleSuggestions(
  admin: AdminClient,
  clientUserId: string,
  rule: TreasuryRuleRow
): Promise<number> {
  const match = ruleToMatch(rule);
  const matching = await fetchAllRuleMatches(admin, clientUserId, match, {
    labelNullOnly: true,
  });
  const matchIds = new Set(matching.map((t) => t.id));

  const { data: existing } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id")
    .eq("rule_id", rule.id)
    .eq("client_user_id", clientUserId);

  const orphanIds = (existing ?? [])
    .map((r) => r.transaction_id)
    .filter((id) => !matchIds.has(id));

  // Delete orphans in chunks (never huge single .in if enormous — but orphans
  // are bounded by prior queue size; chunk for safety).
  const DEL = 200;
  for (let i = 0; i < orphanIds.length; i += DEL) {
    const chunk = orphanIds.slice(i, i + DEL);
    if (chunk.length === 0) continue;
    const { error } = await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("rule_id", rule.id)
      .in("transaction_id", chunk);
    if (error) throw error;
  }

  return applyRulesForClient(admin, clientUserId, rule.id);
}

/**
 * Spec 58/63 — suggest via shared SQL predicate (no JS merchantMatches).
 * Confirmed (label set) never touched.
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
  const cadenceByRule = await precomputeCadenceByRule(
    admin,
    clientUserId,
    typedRules
  );

  const pending: SuggestionInsert[] = [];

  for (const rule of typedRules) {
    const txs = await fetchAllRuleMatches(
      admin,
      clientUserId,
      ruleToMatch(rule),
      { labelNullOnly: true }
    );
    const cadence = cadenceByRule.get(rule.id)!;
    const explanation = buildRuleSuggestionExplanation(rule, cadence.label);

    for (const tx of txs) {
      pending.push({
        transaction_id: tx.id,
        rule_id: rule.id,
        client_user_id: clientUserId,
        suggested_label: rule.assign_label,
        suggestion_explanation: explanation,
      });
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
