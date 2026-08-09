import type { SupabaseClient } from "@supabase/supabase-js";
import type { SummaryBucket } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type SummaryRow = {
  period_start: string;
  iso_currency_code: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
};

/** Spec 67 B2 — one aggregate RPC (no fetch-all). */
export async function querySummary(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    bucket: SummaryBucket;
    from?: string;
    to?: string;
    accountId?: string;
  }
): Promise<SummaryRow[]> {
  const { data, error } = await admin.rpc("treasury_query_summary", {
    p_client: clientUserId,
    p_bucket: opts.bucket,
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
    p_account_id: opts.accountId ?? null,
  });
  if (error) {
    console.error("[querySummary]", error);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as SummaryRow[];
  return rows.map((r) => ({
    period_start: String(r.period_start).slice(0, 10),
    iso_currency_code: r.iso_currency_code ?? "USD",
    inflow: Number(r.inflow) || 0,
    outflow: Number(r.outflow) || 0,
    net: Number(r.net) || 0,
    count: Number(r.count) || 0,
  }));
}
