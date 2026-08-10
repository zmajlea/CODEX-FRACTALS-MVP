import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type MonthlyCategoryRow = {
  label: string;
  direction: "in" | "out";
  month: string;
  total: number;
};

/** Nested label → month → amount (both directions merged by label key). */
export type MonthlyByCategorySeries = Record<
  string,
  Record<string, { in: number; out: number }>
>;

function nestCategoryRows(rows: MonthlyCategoryRow[]): MonthlyByCategorySeries {
  const out: MonthlyByCategorySeries = {};
  for (const row of rows) {
    const label = row.label === "__uncategorized__" ? row.label : row.label;
    const month = row.month.slice(0, 10);
    const bucket = out[label] ?? {};
    const cell = bucket[month] ?? { in: 0, out: 0 };
    if (row.direction === "in") cell.in += row.total;
    else cell.out += row.total;
    bucket[month] = cell;
    out[label] = bucket;
  }
  return out;
}

/** Spec 65 — one RPC scan; no fetch-all. Split txs contribute slices only (never label+split). */
export async function loadMonthlyByCategory(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    accountId: string;
    from: string;
    to: string;
    direction?: "in" | "out" | null;
  }
): Promise<MonthlyByCategorySeries> {
  const { data, error } = await admin.rpc("treasury_monthly_by_category", {
    p_client: clientUserId,
    p_account_id: opts.accountId,
    p_from: opts.from,
    p_to: opts.to,
    p_direction: opts.direction ?? null,
  });
  if (error) {
    console.error("[loadMonthlyByCategory]", error);
    throw new Error(error.message);
  }
  const rows = (data ?? []) as MonthlyCategoryRow[];
  return nestCategoryRows(
    rows.map((r) => ({
      label: r.label,
      direction: r.direction,
      month: String(r.month).slice(0, 10),
      total: Number(r.total) || 0,
    }))
  );
}

/** Flat monthly totals per label+direction for reconciliation. */
export async function loadMonthlyByCategoryFlat(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    accountId: string;
    from: string;
    to: string;
    direction?: "in" | "out" | null;
  }
): Promise<MonthlyCategoryRow[]> {
  const { data, error } = await admin.rpc("treasury_monthly_by_category", {
    p_client: clientUserId,
    p_account_id: opts.accountId,
    p_from: opts.from,
    p_to: opts.to,
    p_direction: opts.direction ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MonthlyCategoryRow[]).map((r) => ({
    label: r.label,
    direction: r.direction,
    month: String(r.month).slice(0, 10),
    total: Number(r.total) || 0,
  }));
}
