import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evidenceAsJson,
  parseEvidence,
  type Evidence,
} from "@/lib/treasury/evidence";
import type { DraftKind } from "@/lib/treasury/pickable";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

export {
  appendTransactionEvidence,
  assertTransactionsBelongToClient,
  evidenceAsJson,
  evidenceRunningTotal,
  parseEvidence,
  removeEvidenceItem,
  resolveEvidenceLive,
  snapshotEvidence,
  snapshotEvidenceAtSeal,
} from "@/lib/treasury/evidence";

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

export type { Evidence };
