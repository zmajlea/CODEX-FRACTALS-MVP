import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptForClient } from "@/lib/server/envelope-crypto";
import { plaid } from "@/lib/server/plaid";
import type {
  TreasuryAccountView,
  TreasuryAccountsResponse,
  TreasuryInstitutionView,
  TreasuryTransaction,
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

/** Cache-only read from treasury_accounts + plaid_items metadata (no Plaid calls). */
export async function readTreasuryCacheForClient(
  admin: AdminClient,
  clientUserId: string
): Promise<TreasuryAccountsResponse> {
  const { data: items, error: itemsErr } = await admin
    .from("plaid_items")
    .select("id, institution_name")
    .eq("client_user_id", clientUserId);

  if (itemsErr) {
    console.error("[treasury-sync] cache load items", itemsErr);
    throw new Error("Failed to load treasury cache");
  }

  const { data: accountRows, error: acctErr } = await admin
    .from("treasury_accounts")
    .select(
      "plaid_item_id, account_id, name, mask, type, subtype, current_balance, available_balance, iso_currency_code"
    )
    .eq("client_user_id", clientUserId);

  if (acctErr) {
    console.error("[treasury-sync] cache load accounts", acctErr);
    throw new Error("Failed to load treasury cache");
  }

  const accountsByItem = new Map<string, TreasuryAccountView[]>();
  for (const row of accountRows ?? []) {
    const list = accountsByItem.get(row.plaid_item_id) ?? [];
    list.push(mapAccountRow(row));
    accountsByItem.set(row.plaid_item_id, list);
  }

  const institutions: TreasuryInstitutionView[] = (items ?? []).map((item) => ({
    item_id: item.id,
    institution_name: item.institution_name,
    needs_reconnect: false,
    accounts: accountsByItem.get(item.id) ?? [],
  }));

  return { institutions, transactions: [] };
}

/** Live Plaid sync: decrypt tokens, refresh balances, fetch recent transactions. */
export async function syncTreasuryForClient(
  admin: AdminClient,
  clientUserId: string
): Promise<TreasuryAccountsResponse> {
  const { data: items, error: itemsErr } = await admin
    .from("plaid_items")
    .select("id, institution_name, access_token_ciphertext")
    .eq("client_user_id", clientUserId);

  if (itemsErr) {
    console.error("[treasury-sync] load items", itemsErr);
    throw new Error("Failed to load plaid items");
  }

  const institutions: TreasuryInstitutionView[] = [];
  const transactions: TreasuryTransaction[] = [];

  for (const item of items ?? []) {
    let needsReconnect = false;
    let keyDestroyed = false;
    const accounts: TreasuryAccountView[] = [];

    try {
      const accessToken = await decryptForClient(
        admin,
        clientUserId,
        item.access_token_ciphertext
      );

      const balanceRes = await plaid.accountsBalanceGet({
        access_token: accessToken,
      });

      for (const acct of balanceRes.data.accounts) {
        accounts.push({
          account_id: acct.account_id,
          name: acct.name,
          mask: acct.mask,
          type: acct.type,
          subtype: acct.subtype,
          current_balance: acct.balances.current,
          available_balance: acct.balances.available,
          iso_currency_code: acct.balances.iso_currency_code,
        });

        await admin.from("treasury_accounts").upsert(
          {
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
          { onConflict: "plaid_item_id,account_id" }
        );
      }

      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);

      try {
        const txRes = await plaid.transactionsGet({
          access_token: accessToken,
          start_date: start.toISOString().slice(0, 10),
          end_date: end.toISOString().slice(0, 10),
          options: { count: 50, offset: 0 },
        });

        for (const tx of txRes.data.transactions) {
          transactions.push({
            date: tx.date,
            name: tx.merchant_name ?? tx.name,
            amount: tx.amount,
            iso_currency_code: tx.iso_currency_code,
            account_id: tx.account_id,
            pending: tx.pending,
          });
        }
      } catch (txErr) {
        console.warn("[treasury-sync] transactions fetch", txErr);
      }
    } catch (err) {
      if (isKeyDestroyedError(err)) {
        keyDestroyed = true;
      } else if (isLoginRequired(err)) {
        needsReconnect = true;
      } else {
        console.error("[treasury-sync] item fetch", err);
        needsReconnect = true;
      }
    }

    institutions.push({
      item_id: item.id,
      institution_name: item.institution_name,
      needs_reconnect: needsReconnect,
      key_destroyed: keyDestroyed,
      accounts,
    });
  }

  transactions.sort((a, b) => b.date.localeCompare(a.date));

  return {
    institutions,
    transactions: transactions.slice(0, 50),
  };
}
