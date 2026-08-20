/**
 * Spec B5 — read-only ledger rows for arbitrary subdivision bucketing.
 * Same tenant/account scoping as monthly loaders; splits-aware like reconcile oracle.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MetricSubdivision } from "@/lib/mcp/metrics-schema";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";

type AdminClient = SupabaseClient<Database>;

export type BucketedCategoryRow = {
  label: string;
  direction: "in" | "out";
  /** ISO date of the transaction (YYYY-MM-DD). */
  posted_date: string;
  total: number;
};

function isoWeekStart(d: Date): string {
  // ISO week: Monday start
  const day = d.getUTCDay() || 7; // Sun=7
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1))
  );
  return monday.toISOString().slice(0, 10);
}

function quarterStart(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) * 3;
  return `${d.getUTCFullYear()}-${String(q + 1).padStart(2, "0")}-01`;
}

/** Bucket key (start date) for a posted date under the given subdivision. */
export function bucketStartForDate(
  postedDate: string,
  subdivision: MetricSubdivision
): string {
  const d = new Date(`${postedDate.slice(0, 10)}T00:00:00.000Z`);
  switch (subdivision) {
    case "day":
      return postedDate.slice(0, 10);
    case "week":
      return isoWeekStart(d);
    case "month":
      return `${postedDate.slice(0, 7)}-01`;
    case "quarter":
      return quarterStart(d);
    case "year":
      return `${postedDate.slice(0, 4)}-01-01`;
    default:
      return postedDate.slice(0, 10);
  }
}

export function bucketLabel(
  bucketStart: string,
  subdivision: MetricSubdivision
): string {
  switch (subdivision) {
    case "day":
      return bucketStart;
    case "week":
      return `W ${bucketStart}`;
    case "month":
      return bucketStart.slice(0, 7);
    case "quarter": {
      const m = Number(bucketStart.slice(5, 7));
      const q = Math.floor((m - 1) / 3) + 1;
      return `${bucketStart.slice(0, 4)}-Q${q}`;
    }
    case "year":
      return bucketStart.slice(0, 4);
    default:
      return bucketStart;
  }
}

/** Advance a bucket start by one subdivision unit. */
export function nextBucketStart(
  bucketStart: string,
  subdivision: MetricSubdivision
): string {
  const d = new Date(`${bucketStart}T00:00:00.000Z`);
  switch (subdivision) {
    case "day":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarter":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Inclusive calendar end of a bucket (last day that belongs to it).
 * Used for partial-edge detection against the window.
 */
export function bucketEndDate(
  bucketStart: string,
  subdivision: MetricSubdivision
): string {
  const next = nextBucketStart(bucketStart, subdivision);
  const d = new Date(`${next}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Flat category rows with posted dates for TS bucketing.
 * Monthly subdivision callers may prefer loadMonthlyByCategoryFlat; this path
 * is the general day/week/month/quarter/year source.
 */
export async function loadBucketedByCategoryFlat(
  admin: AdminClient,
  clientUserId: string,
  opts: {
    /** Spec B6 — omit/null = all client accounts. */
    accountId?: string | null;
    from: string;
    to: string;
    direction?: "in" | "out" | null;
  }
): Promise<BucketedCategoryRow[]> {
  const txs = await fetchAllRows((rangeFrom, rangeTo) => {
    let q = admin
      .from("treasury_transactions")
      .select("id, label, direction, amount, posted_date")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .gte("posted_date", opts.from)
      .lte("posted_date", opts.to)
      .in("direction", ["in", "out"])
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(rangeFrom, rangeTo);
    if (opts.accountId) {
      q = q.eq("account_id", opts.accountId);
    }
    if (opts.direction === "in" || opts.direction === "out") {
      q = q.eq("direction", opts.direction);
    }
    return q;
  });

  const txIds = txs.map((t) => t.id as string);
  const splitByTx = new Map<string, { label: string; amount: number }[]>();

  // Chunk IN queries to avoid URL limits
  const CHUNK = 200;
  for (let i = 0; i < txIds.length; i += CHUNK) {
    const slice = txIds.slice(i, i + CHUNK);
    if (!slice.length) continue;
    const { data: splits, error: splitErr } = await admin
      .from("treasury_transaction_splits")
      .select("transaction_id, label, amount")
      .in("transaction_id", slice);
    if (splitErr) throw new Error(splitErr.message);
    for (const s of splits ?? []) {
      const list = splitByTx.get(s.transaction_id) ?? [];
      list.push({ label: s.label, amount: Number(s.amount) });
      splitByTx.set(s.transaction_id, list);
    }
  }

  const rows: BucketedCategoryRow[] = [];
  for (const t of txs) {
    if (!t.posted_date || (t.direction !== "in" && t.direction !== "out")) continue;
    if (opts.direction && t.direction !== opts.direction) continue;
    const posted = String(t.posted_date).slice(0, 10);
    const slices = splitByTx.get(t.id as string);
    if (slices?.length) {
      for (const s of slices) {
        const label = s.label?.trim() ? s.label.trim() : "__uncategorized__";
        rows.push({
          label,
          direction: t.direction,
          posted_date: posted,
          total: Math.abs(s.amount),
        });
      }
    } else {
      const label =
        typeof t.label === "string" && t.label.trim()
          ? t.label.trim()
          : "__uncategorized__";
      rows.push({
        label,
        direction: t.direction,
        posted_date: posted,
        total: Math.abs(Number(t.amount) || 0),
      });
    }
  }
  return rows;
}
