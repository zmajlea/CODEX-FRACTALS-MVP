import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RecommendationEvidence,
  RecommendationTxSnap,
  ResolvedEvidenceItem,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";
import type { Database, Json } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

function payeeFromRow(row: {
  merchant_name: string | null;
  normalized_merchant: string | null;
  raw_name: string | null;
}): string | null {
  return row.merchant_name ?? row.normalized_merchant ?? row.raw_name ?? null;
}

export function parseEvidence(raw: unknown): RecommendationEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: RecommendationEvidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    const id = typeof rec.id === "string" ? rec.id : null;
    if (!id) continue;
    if (kind === "transaction" || kind === "study" || kind === "backtest") {
      const snap =
        rec.snap && typeof rec.snap === "object"
          ? (rec.snap as RecommendationTxSnap)
          : undefined;
      if (kind === "transaction") {
        out.push({ kind, id, ...(snap ? { snap } : {}) });
      } else {
        out.push({ kind, id, ...(rec.snap !== undefined ? { snap: rec.snap } : {}) });
      }
    }
  }
  return out;
}

export function evidenceAsJson(evidence: RecommendationEvidence[]): Json {
  return evidence as unknown as Json;
}

export function normalizeRecommendationRow(
  row: Record<string, unknown>
): TreasuryRecommendationRow {
  return {
    ...(row as unknown as TreasuryRecommendationRow),
    evidence: parseEvidence(row.evidence),
  };
}

export async function findOpenDraft(
  admin: AdminClient,
  clientUserId: string,
  operatorId: string
): Promise<TreasuryRecommendationRow | null> {
  const { data, error } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("client_user_id", clientUserId)
    .eq("created_by", operatorId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeRecommendationRow(data as Record<string, unknown>);
}

/** One open draft per (operator, client). Creates empty draft if none. */
export async function findOrCreateOpenDraft(
  admin: AdminClient,
  input: {
    clientUserId: string;
    operatorId: string;
    tenantId: string | null;
  }
): Promise<{ draft: TreasuryRecommendationRow; created: boolean; error?: string }> {
  const existing = await findOpenDraft(admin, input.clientUserId, input.operatorId);
  if (existing) return { draft: existing, created: false };

  const insert: Database["public"]["Tables"]["treasury_recommendations"]["Insert"] = {
    client_user_id: input.clientUserId,
    operator_tenant_id: input.tenantId,
    created_by: input.operatorId,
    title: "",
    why: "",
    category: "liquidity",
    status: "draft",
    evidence: [],
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

export function appendTransactionEvidence(
  evidence: RecommendationEvidence[],
  transactionIds: string[]
): RecommendationEvidence[] {
  const seen = new Set(
    evidence.filter((e) => e.kind === "transaction").map((e) => e.id)
  );
  const next = [...evidence];
  for (const id of transactionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({ kind: "transaction", id });
  }
  return next;
}

export function removeEvidenceItem(
  evidence: RecommendationEvidence[],
  kind: RecommendationEvidence["kind"],
  id: string
): RecommendationEvidence[] {
  return evidence.filter((e) => !(e.kind === kind && e.id === id));
}

export async function resolveEvidenceLive(
  admin: AdminClient,
  clientUserId: string,
  evidence: RecommendationEvidence[]
): Promise<{ items: ResolvedEvidenceItem[]; missingCount: number }> {
  const txIds = evidence.filter((e) => e.kind === "transaction").map((e) => e.id);
  const byId = new Map<
    string,
    {
      posted_date: string | null;
      authorized_date: string | null;
      amount: number;
      direction: string | null;
      merchant_name: string | null;
      normalized_merchant: string | null;
      raw_name: string | null;
      label: string | null;
    }
  >();

  if (txIds.length > 0) {
    const { data } = await admin
      .from("treasury_transactions")
      .select(
        "id, posted_date, authorized_date, amount, direction, merchant_name, normalized_merchant, raw_name, label"
      )
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .in("id", txIds);

    for (const row of data ?? []) {
      byId.set(row.id, row);
    }
  }

  const items: ResolvedEvidenceItem[] = [];
  let missingCount = 0;

  for (const ev of evidence) {
    if (ev.kind !== "transaction") continue;
    const row = byId.get(ev.id);
    if (!row) {
      missingCount += 1;
      items.push({ kind: "transaction", id: ev.id, available: false });
      continue;
    }
    const date = row.posted_date ?? row.authorized_date ?? "";
    const direction =
      row.direction === "in" || row.direction === "out" ? row.direction : null;
    items.push({
      kind: "transaction",
      id: ev.id,
      available: true,
      date,
      payee: payeeFromRow(row),
      amount: Number(row.amount),
      category: row.label,
      direction,
      raw_name: row.raw_name,
    });
  }

  return { items, missingCount };
}

export async function snapshotEvidenceAtSeal(
  admin: AdminClient,
  clientUserId: string,
  evidence: RecommendationEvidence[]
): Promise<RecommendationEvidence[]> {
  const { items } = await resolveEvidenceLive(admin, clientUserId, evidence);
  const liveById = new Map(
    items.filter((i) => i.available).map((i) => [i.id, i] as const)
  );

  return evidence.map((ev) => {
    if (ev.kind !== "transaction") return ev;
    const live = liveById.get(ev.id);
    if (!live || !live.available) {
      return { kind: "transaction" as const, id: ev.id };
    }
    const snap: RecommendationTxSnap = {
      date: live.date,
      payee: live.payee,
      amount: live.amount,
      category: live.category,
      direction: live.direction,
    };
    return { kind: "transaction", id: ev.id, snap };
  });
}

export async function assertTransactionsBelongToClient(
  admin: AdminClient,
  clientUserId: string,
  transactionIds: string[]
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  if (transactionIds.length === 0) return { ok: true };
  const unique = [...new Set(transactionIds)];
  const { data } = await admin
    .from("treasury_transactions")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .in("id", unique);

  const found = new Set((data ?? []).map((r) => r.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

/** Running total only when every available item shares one direction. */
export function evidenceRunningTotal(
  items: ResolvedEvidenceItem[]
): { direction: "in" | "out"; total: number } | null {
  const available = items.filter((i) => i.available);
  if (available.length === 0) return null;
  const dirs = new Set(available.map((i) => i.direction));
  if (dirs.size !== 1) return null;
  const direction = [...dirs][0];
  if (direction !== "in" && direction !== "out") return null;
  const total = available.reduce((sum, i) => sum + Math.abs(i.amount), 0);
  return { direction, total };
}
