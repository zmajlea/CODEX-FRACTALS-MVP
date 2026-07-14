import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { amountToDirection, normalizeMerchant } from "@/lib/treasury/normalize";
import type { NormalizedTxRow, TreasurySource } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type UpsertTransactionsResult = {
  upserted: number;
  removed: number;
};

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

/** Shared ingest target for Plaid and CSV adapters. */
export async function upsertTransactions(
  admin: AdminClient,
  clientUserId: string,
  rows: NormalizedTxRow[],
  source: TreasurySource
): Promise<UpsertTransactionsResult> {
  let upserted = 0;
  let removed = 0;

  for (const row of rows) {
    if (row.is_removed) {
      const { error } = await admin
        .from("treasury_transactions")
        .update({ is_removed: true, pending: false })
        .eq("client_user_id", clientUserId)
        .eq("source", source)
        .eq("external_id", row.external_id);
      if (!error) removed += 1;
      continue;
    }

    const payload = rowToDbPayload(clientUserId, source, row);

    const { data: existing } = await admin
      .from("treasury_transactions")
      .select(
        "id, label, description, label_source, labeled_by, labeled_at, pending_external_id"
      )
      .eq("client_user_id", clientUserId)
      .eq("source", source)
      .eq("external_id", row.external_id)
      .maybeSingle();

    if (!existing && row.pending_external_id) {
      const { data: pendingRow } = await admin
        .from("treasury_transactions")
        .select("label, description, label_source, labeled_by, labeled_at")
        .eq("client_user_id", clientUserId)
        .eq("source", source)
        .eq("external_id", row.pending_external_id)
        .maybeSingle();

      if (pendingRow?.label) {
        Object.assign(payload, {
          label: pendingRow.label,
          description: pendingRow.description,
          label_source: pendingRow.label_source,
          labeled_by: pendingRow.labeled_by,
          labeled_at: pendingRow.labeled_at,
          suggested_label: null,
          suggested_by_rule_id: null,
          suggestion_status: null,
          suggestion_explanation: null,
        });
      }
    } else if (existing?.label) {
      Object.assign(payload, {
        label: existing.label,
        description: existing.description,
        label_source: existing.label_source,
        labeled_by: existing.labeled_by,
        labeled_at: existing.labeled_at,
      });
    }

    const { error } = await admin.from("treasury_transactions").upsert(payload, {
      onConflict: "client_user_id,source,external_id",
    });

    if (error) {
      console.error("[treasury-ingest] upsert", error);
      throw error;
    }
    upserted += 1;
  }

  return { upserted, removed };
}

export async function loadRecentTransactionsForClient(
  admin: AdminClient,
  clientUserId: string,
  limit = 50
) {
  const { data, error } = await admin
    .from("treasury_transactions")
    .select(
      "posted_date, raw_name, merchant_name, amount, iso_currency_code, account_id, pending, direction"
    )
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .order("posted_date", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((tx) => ({
    date: tx.posted_date ?? "",
    name: tx.merchant_name ?? tx.raw_name ?? "Transaction",
    amount: Number(tx.amount),
    iso_currency_code: tx.iso_currency_code,
    account_id: tx.account_id,
    pending: tx.pending,
    direction: tx.direction as "in" | "out" | null,
  }));
}
