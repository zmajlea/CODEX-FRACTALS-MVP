import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { detectCadence, merchantMatches } from "@/lib/server/treasury-rule-helpers";
import { normalizeMerchant } from "@/lib/treasury/normalize";
import type { SummaryBucket, TreasuryRuleRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export { detectCadence, merchantMatches } from "@/lib/server/treasury-rule-helpers";
export type { CadenceDetection } from "@/lib/server/treasury-rule-helpers";

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
    parts.push(`$${rule.amount_min ?? 0}–$${rule.amount_max ?? "∞"}`);
  }
  if (rule.direction) parts.push(rule.direction);
  if (cadenceLabel !== "irregular") parts.push(cadenceLabel);
  return parts.join(", ");
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

  const { data: txs, error: txErr } = await admin
    .from("treasury_transactions")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .eq("pending", false)
    .is("label", null);

  if (txErr) throw txErr;

  const { data: rejections } = await admin
    .from("treasury_rule_rejections")
    .select("transaction_id, rule_id");

  const rejectionSet = new Set(
    (rejections ?? []).map((r) => `${r.transaction_id}:${r.rule_id}`)
  );

  let suggested = 0;

  for (const tx of txs ?? []) {
    const normalized = tx.normalized_merchant ?? normalizeMerchant(tx.raw_name, tx.merchant_name);
    const absAmount = Math.abs(Number(tx.amount));

    for (const rule of rules as TreasuryRuleRow[]) {
      if (rejectionSet.has(`${tx.id}:${rule.id}`)) continue;
      if (!merchantMatches(normalized, rule)) continue;
      if (rule.direction && tx.direction !== rule.direction) continue;
      if (rule.amount_min != null && absAmount < Number(rule.amount_min)) continue;
      if (rule.amount_max != null && absAmount > Number(rule.amount_max)) continue;

      const { data: matchedDates } = await admin
        .from("treasury_transactions")
        .select("posted_date")
        .eq("client_user_id", clientUserId)
        .ilike("normalized_merchant", `%${rule.match_merchant}%`)
        .eq("is_removed", false)
        .not("posted_date", "is", null)
        .limit(24);

      const cadence = detectCadence(
        (matchedDates ?? []).map((d) => d.posted_date as string)
      );

      const explanation = buildRuleSuggestionExplanation(rule, tx, cadence.label);

      await admin
        .from("treasury_transactions")
        .update({
          suggested_label: rule.assign_label,
          suggested_by_rule_id: rule.id,
          suggestion_status: "suggested",
          suggestion_explanation: explanation,
        })
        .eq("id", tx.id)
        .is("label", null);

      suggested += 1;
      break;
    }
  }

  return suggested;
}

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
  let q = admin
    .from("treasury_transactions")
    .select("posted_date, amount, direction, iso_currency_code, label")
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .eq("pending", false);

  if (opts.from) q = q.gte("posted_date", opts.from);
  if (opts.to) q = q.lte("posted_date", opts.to);
  if (opts.accountId) q = q.eq("account_id", opts.accountId);

  const { data, error } = await q;
  if (error) throw error;

  const map = new Map<
    string,
    { inflow: number; outflow: number; net: number; count: number }
  >();

  for (const row of data ?? []) {
    if (!row.posted_date) continue;
    const d = new Date(row.posted_date);
    let period: string;
    if (opts.bucket === "day") {
      period = row.posted_date;
    } else if (opts.bucket === "week") {
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
      period = monday.toISOString().slice(0, 10);
    } else if (opts.bucket === "month") {
      period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    } else {
      period = `${d.getUTCFullYear()}-01-01`;
    }

    const currency = row.iso_currency_code ?? "USD";
    const key = `${period}|${currency}`;
    const entry = map.get(key) ?? { inflow: 0, outflow: 0, net: 0, count: 0 };
    const amt = Math.abs(Number(row.amount));
    if (row.direction === "in") entry.inflow += amt;
    else entry.outflow += amt;
    entry.net = entry.inflow - entry.outflow;
    entry.count += 1;
    map.set(key, entry);
  }

  return [...map.entries()]
    .map(([key, v]) => {
      const [period_start, iso_currency_code] = key.split("|");
      return { period_start: period_start!, iso_currency_code: iso_currency_code!, ...v };
    })
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}
