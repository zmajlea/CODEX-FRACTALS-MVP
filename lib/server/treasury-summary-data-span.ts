import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";

/** Posted_date span for one client book (optionally one account). */
export async function fetchSummaryDataSpan(
  admin: SupabaseClient,
  clientUserId: string,
  accountId?: string
): Promise<{ first: string; last: string } | null> {
  const dateRows = await fetchAllRows((rangeFrom, rangeTo) => {
    let q = admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .not("posted_date", "is", null)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(rangeFrom, rangeTo);
    if (accountId) q = q.eq("account_id", accountId);
    return q;
  });

  let dataFirst: string | null = null;
  let dataLast: string | null = null;
  for (const row of dateRows) {
    const d = row.posted_date as string;
    if (!dataFirst || d < dataFirst) dataFirst = d;
    if (!dataLast || d > dataLast) dataLast = d;
  }
  if (!dataFirst || !dataLast) return null;
  return { first: dataFirst, last: dataLast };
}
