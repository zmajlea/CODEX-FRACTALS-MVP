import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import type { SummaryBucket } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

function aggregateSummaryRows(
  rows: Array<{
    posted_date: string | null;
    amount: number;
    direction: string | null;
    iso_currency_code: string | null;
  }>,
  bucket: SummaryBucket
) {
  const map = new Map<
    string,
    { inflow: number; outflow: number; net: number; count: number }
  >();

  for (const row of rows) {
    if (!row.posted_date) continue;
    const d = new Date(row.posted_date);
    let period: string;
    if (bucket === "day") {
      period = row.posted_date;
    } else if (bucket === "week") {
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
      period = monday.toISOString().slice(0, 10);
    } else if (bucket === "month") {
      period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    } else {
      period = `${d.getUTCFullYear()}-01-01`;
    }

    const currency = row.iso_currency_code ?? "USD";
    const key = `${period}|${currency}`;
    const entry = map.get(key) ?? { inflow: 0, outflow: 0, net: 0, count: 0 };
    if (row.direction === "in") entry.inflow += Math.abs(Number(row.amount));
    else if (row.direction === "out") entry.outflow += Math.abs(Number(row.amount));
    else continue;
    entry.net = entry.inflow - entry.outflow;
    entry.count += 1;
    map.set(key, entry);
  }

  return [...map.entries()]
    .map(([key, v]) => {
      const [period_start, iso_currency_code] = key.split("|");
      return { period_start: period_start!, iso_currency_code: iso_currency_code!, ...v };
    })
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

/** Paginated full-book summary (Spec 31). */
export async function querySummary(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    bucket: SummaryBucket;
    from?: string;
    to?: string;
    accountId?: string;
  }
) {
  const rows = await fetchAllRows((from, to) => {
    let q = admin
      .from("treasury_transactions")
      .select("posted_date, amount, direction, iso_currency_code, label")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (opts.from) q = q.gte("posted_date", opts.from);
    if (opts.to) q = q.lte("posted_date", opts.to);
    if (opts.accountId) q = q.eq("account_id", opts.accountId);

    return q;
  });

  return aggregateSummaryRows(rows, opts.bucket);
}
