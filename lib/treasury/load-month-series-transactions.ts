import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { periodEnd } from "@/lib/treasury/period-bounds";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type MonthSeriesTx = {
  id: string;
  posted_date: string | null;
  amount: number;
  direction: string | null;
  merchant_name: string | null;
  normalized_merchant: string | null;
  raw_name: string | null;
  label: string | null;
  iso_currency_code: string | null;
};

/**
 * Same series as loadMonthlyOutflows — account + direction=out + non-pending + optional label.
 * Used by Analyzer month drill so modal totals reconcile to the bar.
 */
export async function loadMonthSeriesTransactions(
  admin: AdminClient,
  clientUserId: string,
  opts: { accountId: string; label?: string; monthYm: string }
): Promise<{ transactions: MonthSeriesTx[]; outflowTotal: number }> {
  const from = `${opts.monthYm.slice(0, 7)}-01`;
  const to = periodEnd("month", from);

  const rows = await fetchAllRows((rangeFrom, rangeTo) => {
    let q = admin
      .from("treasury_transactions")
      .select(
        "id, posted_date, amount, direction, merchant_name, normalized_merchant, raw_name, label, iso_currency_code"
      )
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .eq("direction", "out")
      .eq("account_id", opts.accountId)
      .gte("posted_date", from)
      .lte("posted_date", to)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(rangeFrom, rangeTo);

    if (opts.label) {
      q = q.eq("label", opts.label);
    }

    return q;
  });

  let outflowTotal = 0;
  const transactions: MonthSeriesTx[] = [];
  for (const row of rows) {
    const amt = Math.abs(Number(row.amount) || 0);
    outflowTotal += amt;
    transactions.push({
      id: row.id as string,
      posted_date: row.posted_date,
      amount: Number(row.amount) || 0,
      direction: row.direction,
      merchant_name: row.merchant_name,
      normalized_merchant: row.normalized_merchant,
      raw_name: row.raw_name,
      label: row.label,
      iso_currency_code: row.iso_currency_code,
    });
  }

  return { transactions, outflowTotal };
}
