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
const UPDATE_CHUNK = 100;

type SuggestionInsert = {
  transaction_id: string;
  rule_id: string;
  client_user_id: string;
  suggested_label: string;
  suggestion_explanation: string;
};

type TxRow = Database["public"]["Tables"]["treasury_transactions"]["Row"];

/** Spec 58 Phase 2 — apply options (groups 1+2 default on; recategorise default off). */
export type ApplyRulesOptions = {
  ruleId?: string;
  /** Group 1: label null, no pending suggestion. Default true. */
  suggestUncategorised?: boolean;
  /** Group 2: label null, already has a pending suggestion. Default true. */
  suggestAlongside?: boolean;
  /** Group 3: rewrite rule_confirmed labels. Default false. Date scope applies here only. */
  recategorise?: boolean;
  /** Inclusive posted_date lower bound for recategorise (YYYY-MM-DD). */
  from?: string | null;
  /** Inclusive posted_date upper bound for recategorise (YYYY-MM-DD). */
  to?: string | null;
  /** Operator id for audit rows when recategorising. */
  actorUserId?: string | null;
};

export type ApplyRulesResult = {
  suggested: number;
  recategorised: number;
  skippedManual: number;
};

/** Spec 58 Phase 2 — match breakdown (date scope only affects categorised groups). */
export type ApplyBreakdown = {
  uncategorised: number;
  suggestedByOthers: number;
  alreadyCategorised: number;
  manualCategorised: number;
  total: number;
  from: string | null;
  to: string | null;
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

function txPassesRuleFilters(tx: TxRow, rule: TreasuryRuleRow): boolean {
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
  ) {
    return false;
  }
  if (rule.direction && tx.direction !== rule.direction) return false;
  const absAmount = Math.abs(Number(tx.amount));
  if (rule.amount_min != null && absAmount < Number(rule.amount_min)) return false;
  if (rule.amount_max != null && absAmount > Number(rule.amount_max)) return false;
  return true;
}

function inDateScope(
  postedDate: string | null,
  from?: string | null,
  to?: string | null
): boolean {
  if (!from && !to) return true;
  if (!postedDate) return false;
  if (from && postedDate < from) return false;
  if (to && postedDate > to) return false;
  return true;
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

async function fetchLabeledCandidatesForRule(
  admin: AdminClient,
  clientUserId: string,
  rule: TreasuryRuleRow,
  from?: string | null,
  to?: string | null
) {
  const safe = escapeIlike(rule.match_merchant);
  return fetchAllRows((offset, end) => {
    let q = admin
      .from("treasury_transactions")
      .select(
        "id, label, label_source, posted_date, amount, direction, normalized_merchant, raw_name, merchant_name, description"
      )
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .not("label", "is", null)
      .or(
        `normalized_merchant.ilike.%${safe}%,raw_name.ilike.%${safe}%,merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`
      )
      .order("id", { ascending: true })
      .range(offset, end);
    if (from) q = q.gte("posted_date", from);
    if (to) q = q.lte("posted_date", to);
    return q;
  });
}

async function loadActiveRules(
  admin: AdminClient,
  clientUserId: string,
  ruleId?: string
): Promise<TreasuryRuleRow[]> {
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
  return (rules ?? []) as TreasuryRuleRow[];
}

/**
 * Spec 58 Phase 2 — breakdown for one rule (or draft match fields via a synthetic rule).
 * Date scope narrows only the categorised counts.
 */
export async function previewRuleApply(
  admin: AdminClient,
  clientUserId: string,
  rule: Pick<
    TreasuryRuleRow,
    | "id"
    | "match_merchant"
    | "match_type"
    | "amount_min"
    | "amount_max"
    | "direction"
    | "assign_label"
  >,
  scope?: { from?: string | null; to?: string | null }
): Promise<ApplyBreakdown> {
  const from = scope?.from ?? null;
  const to = scope?.to ?? null;
  const asRule = rule as TreasuryRuleRow;

  const unlabeled = await fetchUnlabeledForApply(admin, clientUserId);
  let uncategorised = 0;
  let suggestedByOthers = 0;
  for (const tx of unlabeled) {
    if (!txPassesRuleFilters(tx, asRule)) continue;
    if (tx.has_pending_suggestion) suggestedByOthers += 1;
    else uncategorised += 1;
  }

  const labeled = await fetchLabeledCandidatesForRule(
    admin,
    clientUserId,
    asRule,
    from,
    to
  );
  let alreadyCategorised = 0;
  let manualCategorised = 0;
  for (const tx of labeled) {
    if (!txPassesRuleFilters(tx as TxRow, asRule)) continue;
    if (!inDateScope(tx.posted_date, from, to)) continue;
    if (tx.label_source === "manual") manualCategorised += 1;
    else alreadyCategorised += 1; // rule_confirmed or null-source treated as recategorisable
  }

  return {
    uncategorised,
    suggestedByOthers,
    alreadyCategorised,
    manualCategorised,
    total:
      uncategorised +
      suggestedByOthers +
      alreadyCategorised +
      manualCategorised,
    from,
    to,
  };
}

/**
 * Spec 58 Phase 2 — suggest (groups 1+2) and/or recategorise (group 3).
 * Manual labels are never rewritten.
 */
export async function applyRuleActions(
  admin: AdminClient,
  clientUserId: string,
  options: ApplyRulesOptions = {}
): Promise<ApplyRulesResult> {
  const suggestUncategorised = options.suggestUncategorised !== false;
  const suggestAlongside = options.suggestAlongside !== false;
  const recategorise = options.recategorise === true;
  const from = options.from ?? null;
  const to = options.to ?? null;

  const typedRules = await loadActiveRules(admin, clientUserId, options.ruleId);
  if (!typedRules.length) {
    return { suggested: 0, recategorised: 0, skippedManual: 0 };
  }

  const ruleIds = typedRules.map((r) => r.id);
  let suggested = 0;
  let recategorised = 0;
  let skippedManual = 0;

  if (suggestUncategorised || suggestAlongside) {
    const txs = await fetchUnlabeledForApply(admin, clientUserId);
    const { data: rejections } = await admin
      .from("treasury_rule_rejections")
      .select("transaction_id, rule_id")
      .in("rule_id", ruleIds);

    const rejectionSet = new Set(
      (rejections ?? []).map((r) => `${r.transaction_id}:${r.rule_id}`)
    );

    const cadenceByRule = await precomputeCadenceByRule(
      admin,
      clientUserId,
      typedRules
    );

    const pending: SuggestionInsert[] = [];

    for (const tx of txs) {
      const inGroup1 = !tx.has_pending_suggestion;
      const inGroup2 = !!tx.has_pending_suggestion;
      if (inGroup1 && !suggestUncategorised) continue;
      if (inGroup2 && !suggestAlongside) continue;

      for (const rule of typedRules) {
        if (rejectionSet.has(`${tx.id}:${rule.id}`)) continue;
        if (!txPassesRuleFilters(tx, rule)) continue;

        const cadence = cadenceByRule.get(rule.id)!;
        const explanation = buildRuleSuggestionExplanation(rule, cadence.label);

        pending.push({
          transaction_id: tx.id,
          rule_id: rule.id,
          client_user_id: clientUserId,
          suggested_label: rule.assign_label,
          suggestion_explanation: explanation,
        });
      }
    }

    suggested = await upsertSuggestions(admin, pending);
  }

  if (recategorise) {
    const now = new Date().toISOString();
    for (const rule of typedRules) {
      const labeled = await fetchLabeledCandidatesForRule(
        admin,
        clientUserId,
        rule,
        from,
        to
      );

      const targets: Array<{
        id: string;
        prior_label: string | null;
        prior_source: string | null;
      }> = [];

      for (const tx of labeled) {
        if (!txPassesRuleFilters(tx as TxRow, rule)) continue;
        if (!inDateScope(tx.posted_date, from, to)) continue;
        if (tx.label_source === "manual") {
          skippedManual += 1;
          continue;
        }
        targets.push({
          id: tx.id,
          prior_label: tx.label,
          prior_source: tx.label_source,
        });
      }

      for (let i = 0; i < targets.length; i += UPDATE_CHUNK) {
        const chunk = targets.slice(i, i + UPDATE_CHUNK);
        for (const t of chunk) {
          const { error } = await admin
            .from("treasury_transactions")
            .update({
              label: rule.assign_label,
              label_source: "rule_confirmed",
              labeled_by: options.actorUserId ?? null,
              labeled_at: now,
              suggested_by_rule_id: rule.id,
              suggestion_status: "confirmed",
              suggested_label: null,
              suggestion_explanation: null,
            })
            .eq("id", t.id)
            .eq("client_user_id", clientUserId);
          if (error) throw error;

          await admin
            .from("treasury_transaction_suggestions")
            .delete()
            .eq("transaction_id", t.id);

          if (options.actorUserId) {
            const { error: auditErr } = await admin
              .from("user_audit_events")
              .insert({
                user_id: options.actorUserId,
                event_type: "treasury_tx_recategorised",
                payload: {
                  client_user_id: clientUserId,
                  transaction_id: t.id,
                  rule_id: rule.id,
                  prior_label: t.prior_label,
                  prior_label_source: t.prior_source,
                  new_label: rule.assign_label,
                  from,
                  to,
                },
              });
            if (auditErr) {
              console.error("[treasury-audit] treasury_tx_recategorised", auditErr);
            }
          }
          recategorised += 1;
        }
      }
    }
  }

  const now = new Date().toISOString();
  await admin
    .from("treasury_rules")
    .update({ last_applied_at: now })
    .in(
      "id",
      typedRules.map((r) => r.id)
    );

  return { suggested, recategorised, skippedManual };
}

/**
 * Spec 58 — every matching rule proposes into treasury_transaction_suggestions.
 * Phase 1 defaults: suggest groups 1+2, never recategorise.
 *
 * @returns number of suggestion upserts performed
 */
export async function applyRulesForClient(
  admin: AdminClient,
  clientUserId: string,
  ruleId?: string
): Promise<number> {
  const result = await applyRuleActions(admin, clientUserId, {
    ruleId,
    suggestUncategorised: true,
    suggestAlongside: true,
    recategorise: false,
  });
  return result.suggested;
}
