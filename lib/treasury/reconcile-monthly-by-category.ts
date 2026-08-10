/**
 * Spec 65 — direct monthly totals for loader reconciliation (splits-aware).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MonthlyCategoryRow } from "@/lib/treasury/load-monthly-by-category";

type AdminClient = SupabaseClient<Database>;

function monthKey(postedDate: string): string {
  return `${postedDate.slice(0, 7)}-01`;
}

/** Client-side oracle: same split precedence as treasury_monthly_by_category RPC. */
export async function directMonthlyByCategory(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    accountId: string;
    from: string;
    to: string;
    direction?: "in" | "out" | null;
  }
): Promise<MonthlyCategoryRow[]> {
  const { data: txs, error } = await admin
    .from("treasury_transactions")
    .select("id, label, direction, amount, posted_date")
    .eq("client_user_id", clientUserId)
    .eq("account_id", opts.accountId)
    .eq("is_removed", false)
    .eq("pending", false)
    .gte("posted_date", opts.from)
    .lte("posted_date", opts.to)
    .in("direction", ["in", "out"]);

  if (error) throw new Error(error.message);

  const txIds = (txs ?? []).map((t) => t.id);
  const splitByTx = new Map<string, { label: string; amount: number }[]>();

  if (txIds.length > 0) {
    const { data: splits, error: splitErr } = await admin
      .from("treasury_transaction_splits")
      .select("transaction_id, label, amount")
      .in("transaction_id", txIds);
    if (splitErr) throw new Error(splitErr.message);
    for (const s of splits ?? []) {
      const list = splitByTx.get(s.transaction_id) ?? [];
      list.push({ label: s.label, amount: Number(s.amount) });
      splitByTx.set(s.transaction_id, list);
    }
  }

  const totals = new Map<string, number>();

  const add = (label: string, direction: string, month: string, amount: number) => {
    if (opts.direction && direction !== opts.direction) return;
    const key = `${label}\0${direction}\0${month}`;
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(amount));
  };

  for (const t of txs ?? []) {
    if (!t.posted_date || (t.direction !== "in" && t.direction !== "out")) continue;
    const month = monthKey(t.posted_date);
    const slices = splitByTx.get(t.id);
    if (slices?.length) {
      for (const s of slices) {
        const label = s.label?.trim() ? s.label.trim() : "__uncategorized__";
        add(label, t.direction, month, s.amount);
      }
    } else {
      const label = t.label?.trim() ? t.label.trim() : "__uncategorized__";
      add(label, t.direction, month, Number(t.amount));
    }
  }

  const rows: MonthlyCategoryRow[] = [];
  for (const [key, total] of totals) {
    const [label, direction, month] = key.split("\0") as [string, "in" | "out", string];
    rows.push({ label, direction, month, total });
  }
  rows.sort((a, b) =>
    a.label.localeCompare(b.label) ||
    a.direction.localeCompare(b.direction) ||
    a.month.localeCompare(b.month)
  );
  return rows;
}
