import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfMonth } from "@/lib/treasury/period-bounds";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

function monthKeyFromDate(postedDate: string): string {
  return startOfMonth(postedDate.slice(0, 10));
}

export async function loadMonthlyOutflows(
  admin: AdminClient,
  clientUserId: string,
  opts: { accountId: string; label?: string; from: string; to: string }
): Promise<Record<string, number>> {
  const rows = await fetchAllRows((from, to) => {
    let q = admin
      .from("treasury_transactions")
      .select("posted_date, amount")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .eq("direction", "out")
      .eq("account_id", opts.accountId)
      .gte("posted_date", opts.from)
      .lte("posted_date", opts.to)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (opts.label) {
      q = q.eq("label", opts.label);
    }

    return q;
  });

  const map: Record<string, number> = {};
  for (const row of rows) {
    if (!row.posted_date) continue;
    const key = monthKeyFromDate(row.posted_date);
    map[key] = (map[key] ?? 0) + Math.abs(Number(row.amount));
  }
  return map;
}
