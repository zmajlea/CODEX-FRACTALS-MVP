import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  validateSplitSlices,
  type TransactionSplitSlice,
} from "@/lib/treasury/transaction-splits";

type AdminClient = SupabaseClient<Database>;

export type TreasuryTransactionSplitRow = {
  id: string;
  transaction_id: string;
  label: string;
  amount: number;
  created_at: string;
  updated_at: string;
};

export async function loadTransactionSplits(
  admin: AdminClient,
  transactionId: string
): Promise<TreasuryTransactionSplitRow[]> {
  const { data, error } = await admin
    .from("treasury_transaction_splits")
    .select("*")
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    amount: Number(r.amount),
  }));
}

export async function replaceTransactionSplits(
  admin: AdminClient,
  transactionId: string,
  txAmount: number,
  slices: TransactionSplitSlice[]
): Promise<void> {
  const err = validateSplitSlices(txAmount, slices);
  if (err) throw new Error(err);

  const payload = slices.map((s) => ({
    label: s.label.trim(),
    amount: s.amount,
  }));

  const { error } = await admin.rpc("treasury_replace_transaction_splits", {
    p_transaction_id: transactionId,
    p_slices: payload,
  });
  if (error) throw new Error(error.message);
}
