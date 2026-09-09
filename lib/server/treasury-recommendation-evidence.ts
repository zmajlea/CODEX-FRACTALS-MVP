import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evidenceAsJson,
  parseEvidence,
  tryAppendTransactionEvidence,
  type Evidence,
} from "@/lib/treasury/evidence";
import type { DraftKind } from "@/lib/treasury/pickable";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";
import { fetchRuleMatchPage } from "@/lib/treasury/rule-predicate";

export {
  appendEvidenceItem,
  appendTransactionEvidence,
  tryAppendEvidenceItem,
  tryAppendTransactionEvidence,
  assertTransactionsBelongToClient,
  buildRuleContextTxQueryParams,
  clampRuleContextN,
  currentRuleContextN,
  evidenceAsJson,
  evidenceFromPickable,
  evidenceRunningTotal,
  hasRuleContextCompanion,
  isRuleContextCompanion,
  parseEvidence,
  removeEvidenceItem,
  replaceRuleContextCompanions,
  resolveEvidenceLive,
  RULE_CONTEXT_DEFAULT_N,
  RULE_CONTEXT_MAX_N,
  RULE_CONTEXT_MIN_N,
  ruleContextLabel,
  snapshotEvidence,
  snapshotEvidenceAtSeal,
  txQueryParamsToFilters,
} from "@/lib/treasury/evidence";
export type { RuleLikeForContext } from "@/lib/treasury/evidence";

type AdminClient = SupabaseClient<Database>;

export function normalizeRecommendationRow(
  row: Record<string, unknown>
): TreasuryRecommendationRow {
  const kind =
    row.kind === "question" || row.kind === "recommendation"
      ? row.kind
      : "recommendation";
  return {
    ...(row as unknown as TreasuryRecommendationRow),
    kind,
    evidence: parseEvidence(row.evidence),
    client_response:
      typeof row.client_response === "string" ? row.client_response : null,
    responded_at:
      typeof row.responded_at === "string" ? row.responded_at : null,
  };
}

export async function findOpenDraft(
  admin: AdminClient,
  clientUserId: string,
  operatorId: string,
  kind: DraftKind = "recommendation"
): Promise<TreasuryRecommendationRow | null> {
  const { data, error } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("created_by", operatorId)
    .eq("status", "draft")
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeRecommendationRow(data as Record<string, unknown>);
}

export async function findOpenDrafts(
  admin: AdminClient,
  clientUserId: string,
  operatorId: string
): Promise<{
  recommendation: TreasuryRecommendationRow | null;
  question: TreasuryRecommendationRow | null;
}> {
  const [recommendation, question] = await Promise.all([
    findOpenDraft(admin, clientUserId, operatorId, "recommendation"),
    findOpenDraft(admin, clientUserId, operatorId, "question"),
  ]);
  return { recommendation, question };
}

/** One open draft per (operator, client, kind). */
export async function findOrCreateOpenDraft(
  admin: AdminClient,
  input: {
    clientUserId: string;
    operatorId: string;
    tenantId: string | null;
    kind: DraftKind;
  }
): Promise<{ draft: TreasuryRecommendationRow; created: boolean; error?: string }> {
  const existing = await findOpenDraft(
    admin,
    input.clientUserId,
    input.operatorId,
    input.kind
  );
  if (existing) return { draft: existing, created: false };

  const insert: Database["public"]["Tables"]["treasury_recommendations"]["Insert"] = {
    client_user_id: input.clientUserId,
    operator_tenant_id: input.tenantId,
    created_by: input.operatorId,
    title: "",
    why: "",
    category: "liquidity",
    status: "draft",
    kind: input.kind,
    evidence: evidenceAsJson([]),
    anchor_type: "general",
    anchor_ref: null,
  };

  const { data, error } = await admin
    .from("treasury_recommendations")
    .insert(insert)
    .select("*")
    .single();

  if (error || !data) {
    return {
      draft: null as unknown as TreasuryRecommendationRow,
      created: false,
      error: error?.message ?? "Failed to create draft",
    };
  }

  return {
    draft: normalizeRecommendationRow(data as Record<string, unknown>),
    created: true,
  };
}

const RULE_RECENT_TX_DAYS = 60;
const RULE_RECENT_TX_CAP = 100;

/**
 * B23 — when a rule is picked, attach matching transactions from the trailing
 * ~60 days (absolute ids only, capped).
 */
export async function attachRecentRuleTransactions(
  admin: AdminClient,
  clientUserId: string,
  ruleId: string,
  evidence: Evidence[]
): Promise<{ evidence: Evidence[]; attached: number }> {
  const { data: ruleRow } = await admin
    .from("treasury_rules")
    .select(
      "id, match_merchant, match_type, amount_min, amount_max, direction"
    )
    .eq("id", ruleId)
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (!ruleRow?.match_merchant?.trim()) {
    return { evidence, attached: 0 };
  }

  // Anchor the window to the client's ledger tip (not wall clock) so CSV /
  // delayed books still attach "recent" matching txs.
  const { data: tipRow } = await admin
    .from("treasury_transactions")
    .select("posted_date")
    .eq("client_user_id", clientUserId)
    .not("posted_date", "is", null)
    .order("posted_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tip = tipRow?.posted_date
    ? new Date(`${String(tipRow.posted_date).slice(0, 10)}T00:00:00.000Z`)
    : new Date();
  const from = new Date(tip);
  from.setUTCDate(from.getUTCDate() - RULE_RECENT_TX_DAYS);
  const date_to = tip.toISOString().slice(0, 10);
  const date_from = from.toISOString().slice(0, 10);

  const rows = await fetchRuleMatchPage(
    admin,
    clientUserId,
    {
      payeeQuery: ruleRow.match_merchant,
      matchType: ruleRow.match_type,
      direction:
        ruleRow.direction === "in" || ruleRow.direction === "out"
          ? ruleRow.direction
          : null,
      amount_min: ruleRow.amount_min,
      amount_max: ruleRow.amount_max,
      date_from,
      date_to,
      ruleId: ruleRow.id,
    },
    { labelNullOnly: false, offset: 0, limit: RULE_RECENT_TX_CAP }
  );

  const ids = rows
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) {
    return { evidence, attached: 0 };
  }

  const appended = tryAppendTransactionEvidence(evidence, ids);
  return { evidence: appended.evidence, attached: appended.added };
}

export type { Evidence };
