import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ResetClientDataCounts } from "@/lib/treasury/reset-client-data";

export type { ResetClientDataCounts } from "@/lib/treasury/reset-client-data";

type AdminClient = SupabaseClient<Database>;

export async function countClientDataForReset(
  admin: AdminClient,
  clientUserId: string
): Promise<ResetClientDataCounts> {
  const [
    { count: transactions },
    { count: accounts },
    { count: rules },
    { count: studies },
    { count: recommendations },
    { count: sentRecommendations },
  ] = await Promise.all([
    admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientUserId),
    admin
      .from("treasury_accounts")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientUserId),
    admin
      .from("treasury_rules")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientUserId),
    admin
      .from("treasury_studies")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientUserId),
    admin
      .from("treasury_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientUserId),
    admin
      .from("treasury_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientUserId)
      .or("status.neq.draft,sealed_at.not.is.null"),
  ]);

  const { data: ruleRows } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId);
  const ruleIds = (ruleRows ?? []).map((r) => r.id);

  const { data: txRows } = await admin
    .from("treasury_transactions")
    .select("id")
    .eq("client_user_id", clientUserId);
  const txIds = (txRows ?? []).map((t) => t.id);

  const rejectionKeys = new Set<string>();
  if (ruleIds.length > 0) {
    const { data: byRule } = await admin
      .from("treasury_rule_rejections")
      .select("rule_id, transaction_id")
      .in("rule_id", ruleIds);
    for (const r of byRule ?? []) {
      rejectionKeys.add(`${r.rule_id}:${r.transaction_id}`);
    }
  }
  if (txIds.length > 0) {
    const { data: byTx } = await admin
      .from("treasury_rule_rejections")
      .select("rule_id, transaction_id")
      .in("transaction_id", txIds);
    for (const r of byTx ?? []) {
      rejectionKeys.add(`${r.rule_id}:${r.transaction_id}`);
    }
  }

  return {
    transactions: transactions ?? 0,
    accounts: accounts ?? 0,
    rules: rules ?? 0,
    rule_rejections: rejectionKeys.size,
    studies: studies ?? 0,
    recommendations: recommendations ?? 0,
    sent_recommendations: sentRecommendations ?? 0,
  };
}

/**
 * Ordered deletes with abort-on-failure. Not a single DB transaction —
 * idempotent: re-running completes a partial wipe.
 */
export async function wipeClientTreasuryData(
  admin: AdminClient,
  clientUserId: string
): Promise<ResetClientDataCounts> {
  const before = await countClientDataForReset(admin, clientUserId);

  const { data: rules } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId);
  const ruleIds = (rules ?? []).map((r) => r.id);

  if (ruleIds.length > 0) {
    const { error } = await admin
      .from("treasury_rule_rejections")
      .delete()
      .in("rule_id", ruleIds);
    if (error) {
      throw new ResetPartialError(
        `Failed deleting rule rejections (by rule): ${error.message}`,
        before
      );
    }
  }

  const { data: txs } = await admin
    .from("treasury_transactions")
    .select("id")
    .eq("client_user_id", clientUserId);
  const txIds = (txs ?? []).map((t) => t.id);
  if (txIds.length > 0) {
    const { error } = await admin
      .from("treasury_rule_rejections")
      .delete()
      .in("transaction_id", txIds);
    if (error) {
      throw new ResetPartialError(
        `Failed deleting rule rejections (by transaction): ${error.message}`,
        before
      );
    }
  }

  if (ruleIds.length > 0) {
    const { error } = await admin.from("treasury_rules").delete().in("id", ruleIds);
    if (error) {
      throw new ResetPartialError(`Failed deleting rules: ${error.message}`, before);
    }
  }

  const { error: recErr } = await admin
    .from("treasury_recommendations")
    .delete()
    .eq("client_user_id", clientUserId);
  if (recErr) {
    throw new ResetPartialError(
      `Failed deleting recommendations: ${recErr.message}`,
      before
    );
  }

  const { error: studyErr } = await admin
    .from("treasury_studies")
    .delete()
    .eq("client_user_id", clientUserId);
  if (studyErr) {
    throw new ResetPartialError(`Failed deleting studies: ${studyErr.message}`, before);
  }

  const { error: txErr } = await admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", clientUserId);
  if (txErr) {
    throw new ResetPartialError(
      `Failed deleting transactions: ${txErr.message}`,
      before
    );
  }

  const { error: acctErr } = await admin
    .from("treasury_accounts")
    .delete()
    .eq("client_user_id", clientUserId);
  if (acctErr) {
    throw new ResetPartialError(`Failed deleting accounts: ${acctErr.message}`, before);
  }

  return before;
}

export class ResetPartialError extends Error {
  readonly counts: ResetClientDataCounts;
  constructor(message: string, counts: ResetClientDataCounts) {
    super(message);
    this.name = "ResetPartialError";
    this.counts = counts;
  }
}

export const RESET_PARTIAL_OPERATOR_HINT =
  "Reset did not finish. Run Reset client data again to complete it — deletes are safe to retry.";
