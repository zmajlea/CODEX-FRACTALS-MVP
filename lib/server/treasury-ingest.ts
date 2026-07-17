import "server-only";

export {
  upsertTransactions,
  type UpsertTransactionsResult,
} from "@/lib/treasury/upsert-transactions";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

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
