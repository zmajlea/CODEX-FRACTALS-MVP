import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "plaid";
import { decryptForClient } from "@/lib/server/envelope-crypto";
import { upsertTransactions, loadRecentTransactionsForClient } from "@/lib/server/treasury-ingest";
import { plaid } from "@/lib/server/plaid";
import type {
  NormalizedTxRow,
  TreasuryAccountView,
  TreasuryAccountsResponse,
  TreasuryInstitutionView,
} from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

function isLoginRequired(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { response?: { data?: { error_code?: string } } }).response
    ?.data?.error_code;
  return code === "ITEM_LOGIN_REQUIRED";
}

function isKeyDestroyedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("client encryption key not found") ||
    msg.includes("vault secret not found") ||
    msg.includes("invalid dek")
  );
}

function mapAccountRow(row: {
  account_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
}): TreasuryAccountView {
  return {
    account_id: row.account_id,
    name: row.name,
    mask: row.mask,
    type: row.type,
    subtype: row.subtype,
    current_balance: row.current_balance,
    available_balance: row.available_balance,
    iso_currency_code: row.iso_currency_code,
  };
}

function plaidTxToRow(itemId: string, tx: Transaction): NormalizedTxRow {
  const category = tx.personal_finance_category?.primary ?? tx.category?.[0] ?? null;
  return {
    external_id: tx.transaction_id,
    plaid_item_id: itemId,
    account_id: tx.account_id,
    pending_external_id: tx.pending_transaction_id ?? null,
    posted_date: tx.date,
    authorized_date: tx.authorized_date ?? null,
    amount: tx.amount,
    iso_currency_code: tx.iso_currency_code ?? "USD",
    raw_name: tx.name,
    merchant_name: tx.merchant_name ?? null,
    plaid_category: category,
    pending: tx.pending,
    is_removed: false,
  };
}

export async function syncTransactionsForClient(
  admin: AdminClient,
  clientUserId: string
): Promise<{ upserted: number; removed: number }> {
  const { data: items, error } = await admin
    .from("plaid_items")
    .select("id, access_token_ciphertext, transactions_cursor")
    .eq("client_user_id", clientUserId);

  if (error) throw error;

  let totalUpserted = 0;
  let totalRemoved = 0;

  for (const item of items ?? []) {
    try {
      const accessToken = await decryptForClient(
        admin,
        clientUserId,
        item.access_token_ciphertext
      );

      let cursor = item.transactions_cursor ?? undefined;
      let hasMore = true;

      while (hasMore) {
        const res = await plaid.transactionsSync({
          access_token: accessToken,
          cursor,
          count: 500,
        });

        const added = res.data.added.map((tx) => plaidTxToRow(item.id, tx));
        const modified = res.data.modified.map((tx) => plaidTxToRow(item.id, tx));
        const removed = res.data.removed.map((r) => ({
          external_id: r.transaction_id,
          account_id: "",
          posted_date: null,
          amount: 0,
          is_removed: true,
        }));

        if (added.length > 0) {
          const r = await upsertTransactions(admin, clientUserId, added, "plaid");
          totalUpserted += r.upserted;
        }
        if (modified.length > 0) {
          const r = await upsertTransactions(admin, clientUserId, modified, "plaid");
          totalUpserted += r.upserted;
        }
        if (removed.length > 0) {
          const r = await upsertTransactions(admin, clientUserId, removed, "plaid");
          totalRemoved += r.removed;
        }

        cursor = res.data.next_cursor;
        hasMore = res.data.has_more;
      }

      await admin
        .from("plaid_items")
        .update({
          transactions_cursor: cursor ?? null,
          transactions_last_synced_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    } catch (err) {
      if (!isLoginRequired(err) && !isKeyDestroyedError(err)) {
        console.error("[treasury-sync] transactionsSync", err);
      }
    }
  }

  return { upserted: totalUpserted, removed: totalRemoved };
}

async function buildInstitutions(
  admin: AdminClient,
  clientUserId: string
): Promise<TreasuryInstitutionView[]> {
  const { data: items } = await admin
    .from("plaid_items")
    .select("id, institution_name, institution_id")
    .eq("client_user_id", clientUserId);

  const { data: accountRows } = await admin
    .from("treasury_accounts")
    .select(
      "source, plaid_item_id, account_id, name, mask, type, subtype, current_balance, available_balance, iso_currency_code"
    )
    .eq("client_user_id", clientUserId);

  const accountsByItem = new Map<string, TreasuryAccountView[]>();
  const csvAccounts: TreasuryAccountView[] = [];

  for (const row of accountRows ?? []) {
    const view = mapAccountRow(row);
    if (row.source === "csv" || !row.plaid_item_id) {
      csvAccounts.push(view);
    } else {
      const list = accountsByItem.get(row.plaid_item_id) ?? [];
      list.push(view);
      accountsByItem.set(row.plaid_item_id, list);
    }
  }

  const institutions: TreasuryInstitutionView[] = (items ?? []).map((item) => ({
    item_id: item.id,
    institution_name: item.institution_name,
    institution_id: item.institution_id,
    needs_reconnect: false,
    accounts: accountsByItem.get(item.id) ?? [],
  }));

  if (csvAccounts.length > 0) {
    institutions.push({
      item_id: "csv-manual",
      institution_name: "Imported (CSV)",
      needs_reconnect: false,
      accounts: csvAccounts,
    });
  }

  return institutions;
}

const STALE_SYNC_MS = 5 * 60 * 1000;

export async function getLastTransactionsSyncedAt(
  admin: AdminClient,
  clientUserId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("plaid_items")
    .select("transactions_last_synced_at")
    .eq("client_user_id", clientUserId);

  if (error) throw error;
  const times = (data ?? [])
    .map((r) => r.transactions_last_synced_at)
    .filter(Boolean) as string[];
  if (times.length === 0) return null;
  return times.sort().reverse()[0] ?? null;
}

export async function isTransactionsSyncStale(
  admin: AdminClient,
  clientUserId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("plaid_items")
    .select("transactions_last_synced_at")
    .eq("client_user_id", clientUserId);

  if (error) throw error;
  if (!data?.length) return false;

  const now = Date.now();
  return data.some((item) => {
    if (!item.transactions_last_synced_at) return true;
    return now - new Date(item.transactions_last_synced_at).getTime() > STALE_SYNC_MS;
  });
}

async function countClientTransactions(
  admin: AdminClient,
  clientUserId: string
): Promise<number> {
  const { count, error } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false);

  if (error) throw error;
  return count ?? 0;
}

async function buildResponse(
  admin: AdminClient,
  clientUserId: string,
  syncTriggered: boolean
): Promise<TreasuryAccountsResponse> {
  const institutions = await buildInstitutions(admin, clientUserId);
  const transactions = await loadRecentTransactionsForClient(admin, clientUserId);
  const last_synced_at = await getLastTransactionsSyncedAt(admin, clientUserId);
  const transaction_count = await countClientTransactions(admin, clientUserId);
  return {
    institutions,
    transactions,
    last_synced_at,
    sync_triggered: syncTriggered,
    transaction_count,
  };
}

export async function readTreasuryCacheForClient(
  admin: AdminClient,
  clientUserId: string
): Promise<TreasuryAccountsResponse> {
  return buildResponse(admin, clientUserId, false);
}

export async function syncTreasuryForClient(
  admin: AdminClient,
  clientUserId: string
): Promise<TreasuryAccountsResponse> {
  const { data: items, error: itemsErr } = await admin
    .from("plaid_items")
    .select("id, institution_name, access_token_ciphertext")
    .eq("client_user_id", clientUserId);

  if (itemsErr) throw new Error("Failed to load plaid items");

  for (const item of items ?? []) {
    let needsReconnect = false;
    let keyDestroyed = false;

    try {
      const accessToken = await decryptForClient(
        admin,
        clientUserId,
        item.access_token_ciphertext
      );

      const balanceRes = await plaid.accountsBalanceGet({ access_token: accessToken });

      for (const acct of balanceRes.data.accounts) {
        await admin.from("treasury_accounts").upsert(
          {
            source: "plaid",
            plaid_item_id: item.id,
            client_user_id: clientUserId,
            account_id: acct.account_id,
            name: acct.name,
            mask: acct.mask,
            type: acct.type,
            subtype: acct.subtype,
            current_balance: acct.balances.current,
            available_balance: acct.balances.available,
            iso_currency_code: acct.balances.iso_currency_code,
          },
          { onConflict: "client_user_id,account_id" }
        );
      }
    } catch (err) {
      if (isKeyDestroyedError(err)) keyDestroyed = true;
      else if (isLoginRequired(err)) needsReconnect = true;
      else {
        console.error("[treasury-sync] balance fetch", err);
        needsReconnect = true;
      }
    }

    void needsReconnect;
    void keyDestroyed;
  }

  await syncTransactionsForClient(admin, clientUserId);

  return buildResponse(admin, clientUserId, true);
}
