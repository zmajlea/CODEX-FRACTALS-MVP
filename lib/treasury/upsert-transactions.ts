import type { SupabaseClient } from "@supabase/supabase-js";
import { amountToDirection, normalizeMerchant } from "@/lib/treasury/normalize";
import type { NormalizedTxRow, TreasurySource } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

type TxPayload = Database["public"]["Tables"]["treasury_transactions"]["Insert"];

export type UpsertTransactionsResult = {
  upserted: number;
  inserted: number;
  updated: number;
  removed: number;
};

type ExistingLabelRow = {
  external_id: string;
  label: string | null;
  description: string | null;
  label_source: string | null;
  labeled_by: string | null;
  labeled_at: string | null;
};

const PREFETCH_CHUNK = 200;
const UPSERT_CHUNK = 500;

function chunksOf<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function rowToDbPayload(
  clientUserId: string,
  source: TreasurySource,
  row: NormalizedTxRow
) {
  const normalized = normalizeMerchant(row.raw_name, row.merchant_name);
  return {
    client_user_id: clientUserId,
    source,
    plaid_item_id: row.plaid_item_id ?? null,
    account_id: row.account_id,
    external_id: row.external_id,
    pending_external_id: row.pending_external_id ?? null,
    posted_date: row.posted_date,
    authorized_date: row.authorized_date ?? null,
    amount: row.amount,
    direction: amountToDirection(row.amount),
    iso_currency_code: row.iso_currency_code ?? "USD",
    raw_name: row.raw_name ?? null,
    merchant_name: row.merchant_name ?? null,
    normalized_merchant: normalized || null,
    plaid_category: row.plaid_category ?? null,
    pending: row.pending ?? false,
    is_removed: row.is_removed ?? false,
  };
}

function mergeLabelFields(
  payload: TxPayload,
  labelRow: {
    label: string | null;
    description: string | null;
    label_source: string | null;
    labeled_by: string | null;
    labeled_at: string | null;
  },
  inheritFromPending: boolean
) {
  Object.assign(payload, {
    label: labelRow.label,
    description: labelRow.description,
    label_source: labelRow.label_source,
    labeled_by: labelRow.labeled_by,
    labeled_at: labelRow.labeled_at,
  });
  if (inheritFromPending) {
    Object.assign(payload, {
      suggested_label: null,
      suggested_by_rule_id: null,
      suggestion_status: null,
      suggestion_explanation: null,
    });
  }
}

async function prefetchExistingByExternalId(
  admin: AdminClient,
  clientUserId: string,
  source: TreasurySource,
  externalIds: string[]
): Promise<Map<string, ExistingLabelRow>> {
  const existing = new Map<string, ExistingLabelRow>();
  const uniqueIds = [...new Set(externalIds)];
  for (const chunk of chunksOf(uniqueIds, PREFETCH_CHUNK)) {
    const { data, error } = await admin
      .from("treasury_transactions")
      .select("external_id, label, description, label_source, labeled_by, labeled_at")
      .eq("client_user_id", clientUserId)
      .eq("source", source)
      .in("external_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      existing.set(row.external_id, row as ExistingLabelRow);
    }
  }
  return existing;
}

/** Shared ingest target for Plaid and CSV adapters. */
export async function upsertTransactions(
  admin: AdminClient,
  clientUserId: string,
  rows: NormalizedTxRow[],
  source: TreasurySource
): Promise<UpsertTransactionsResult> {
  const removals = rows.filter((r) => r.is_removed);
  const active = rows.filter((r) => !r.is_removed);

  let removed = 0;
  for (const chunk of chunksOf(
    removals.map((r) => r.external_id),
    PREFETCH_CHUNK
  )) {
    const { error, count } = await admin
      .from("treasury_transactions")
      .update({ is_removed: true, pending: false }, { count: "exact" })
      .eq("client_user_id", clientUserId)
      .eq("source", source)
      .in("external_id", chunk);
    if (error) throw error;
    removed += count ?? chunk.length;
  }

  if (active.length === 0) {
    return { upserted: 0, inserted: 0, updated: 0, removed };
  }

  const existing = await prefetchExistingByExternalId(
    admin,
    clientUserId,
    source,
    active.map((r) => r.external_id)
  );

  const pendingIds = [
    ...new Set(
      active
        .filter((r) => r.pending_external_id && !existing.has(r.external_id))
        .map((r) => r.pending_external_id!)
    ),
  ];

  const pendingByExternalId =
    pendingIds.length > 0
      ? await prefetchExistingByExternalId(
          admin,
          clientUserId,
          source,
          pendingIds
        )
      : new Map<string, ExistingLabelRow>();

  const payloads: TxPayload[] = [];

  for (const row of active) {
    const payload: TxPayload = rowToDbPayload(clientUserId, source, row);

    const prior = existing.get(row.external_id);
    if (prior?.label) {
      mergeLabelFields(payload, prior, false);
    } else if (row.pending_external_id) {
      const pendingRow = pendingByExternalId.get(row.pending_external_id);
      if (pendingRow?.label) {
        mergeLabelFields(payload, pendingRow, true);
      }
    }

    payloads.push(payload);
  }

  const deduped = new Map<string, (typeof payloads)[0]>();
  let droppedDupes = 0;
  for (const p of payloads) {
    if (deduped.has(p.external_id)) droppedDupes += 1;
    deduped.set(p.external_id, p);
  }
  if (droppedDupes > 0) {
    console.warn(
      `[treasury-ingest] deduped ${droppedDupes} duplicate external_id(s) in batch`
    );
  }

  const finalPayloads = [...deduped.values()];

  for (const chunk of chunksOf(finalPayloads, UPSERT_CHUNK)) {
    const { error } = await admin
      .from("treasury_transactions")
      .upsert(chunk, { onConflict: "client_user_id,source,external_id" });
    if (error) {
      console.error("[treasury-ingest] bulk upsert", error);
      throw error;
    }
  }

  const updated = finalPayloads.filter((p) => existing.has(p.external_id)).length;
  const inserted = finalPayloads.length - updated;

  return {
    upserted: finalPayloads.length,
    inserted,
    updated,
    removed,
  };
}
