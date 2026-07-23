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

const UPDATE_ID_CHUNK = 200;

type SuggestionUpdate = {
  suggested_label: string;
  suggested_by_rule_id: string;
  suggestion_status: "suggested";
  suggestion_explanation: string;
};

function formatRuleAmountBound(n: number | null | undefined): string {
  if (n == null) return "∞";
  return formatTreasuryMoney(n, "USD");
}

/** Rule-level "why this matched" — not per-tx. Existing DB rows keep old text until re-suggested. */
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

function updatePayloadKey(update: SuggestionUpdate): string {
  return [
    update.suggested_label,
    update.suggested_by_rule_id,
    update.suggestion_status,
    update.suggestion_explanation,
  ].join("\0");
}

async function applyPendingUpdates(
  admin: AdminClient,
  pending: Array<{ txId: string; update: SuggestionUpdate }>,
  /** When set, UPDATE allows re-stamp of this rule's own rows; when unset, unowned only. */
  ruleIdForGuard: string | undefined
): Promise<number> {
  if (pending.length === 0) return 0;

  const groups = new Map<string, { update: SuggestionUpdate; txIds: string[] }>();
  for (const { txId, update } of pending) {
    const key = updatePayloadKey(update);
    const existing = groups.get(key);
    if (existing) existing.txIds.push(txId);
    else groups.set(key, { update, txIds: [txId] });
  }

  let applied = 0;

  for (const { update, txIds } of groups.values()) {
    for (let i = 0; i < txIds.length; i += UPDATE_ID_CHUNK) {
      const idChunk = txIds.slice(i, i + UPDATE_ID_CHUNK);
      // Spec 55 B belt: label null + owner guard (branched; never eq.undefined)
      const base = admin
        .from("treasury_transactions")
        .update(update)
        .in("id", idChunk)
        .is("label", null);
      const guarded = ruleIdForGuard
        ? base.or(
            `suggested_by_rule_id.is.null,suggested_by_rule_id.eq.${ruleIdForGuard}`
          )
        : base.is("suggested_by_rule_id", null);
      const { data, error } = await guarded.select("id");
      if (error) throw error;
      applied += data?.length ?? 0;
    }
  }

  return applied;
}

/**
 * Spec 55 B — fetch ownership filter (primary). Branched so multi-rule never
 * builds suggested_by_rule_id.eq.undefined.
 *
 * Single-rule (ruleId set):
 *   .is("label", null)
 *   .or("suggestion_status.is.null,suggested_by_rule_id.eq." + ruleId)
 *
 * Multi-rule (no ruleId):
 *   .is("label", null)
 *   .is("suggestion_status", null)
 */
async function fetchUnlabeledForApply(
  admin: AdminClient,
  clientUserId: string,
  ruleId: string | undefined
) {
  return fetchAllRows((from, to) => {
    let q = admin
      .from("treasury_transactions")
      .select("*")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .is("label", null);

    if (ruleId) {
      q = q.or(
        `suggestion_status.is.null,suggested_by_rule_id.eq.${ruleId}`
      );
    } else {
      q = q.is("suggestion_status", null);
    }

    return q.order("id", { ascending: true }).range(from, to);
  });
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

  const txs = await fetchUnlabeledForApply(admin, clientUserId, ruleId);

  const { data: rejections } = await admin
    .from("treasury_rule_rejections")
    .select("transaction_id, rule_id")
    .in("rule_id", ruleIds);

  const rejectionSet = new Set(
    (rejections ?? []).map((r) => `${r.transaction_id}:${r.rule_id}`)
  );

  const cadenceByRule = await precomputeCadenceByRule(admin, clientUserId, typedRules);

  const pending: Array<{ txId: string; update: SuggestionUpdate }> = [];

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

  const applied = await applyPendingUpdates(admin, pending, ruleId);
  if (applied !== pending.length) {
    console.warn(
      `[apply-rules] ${pending.length - applied} suggestion(s) skipped (label set or owned concurrently?)`
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
