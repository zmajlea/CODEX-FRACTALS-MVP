/**
 * Build a month→amount subject series from monthly_by_category inputs.
 * No metric subject this phase.
 */

import {
  buildBucketSeries,
} from "@/lib/treasury/cash-model";
import type { CashModelBucketKey } from "@/lib/treasury/cash-model-types";
import type { MonthlyByCategorySeries } from "@/lib/treasury/load-monthly-by-category";

export type ForecastSubjectKind =
  | "total_in"
  | "total_out"
  | "net"
  | "bucket"
  | "category";

export type ForecastSubject = {
  kind: ForecastSubjectKind;
  id?: string;
};

function monthKey(m: string): string {
  const s = m.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return `${s.slice(0, 7)}-01`;
}

export function buildSubjectSeries(
  categorySeries: MonthlyByCategorySeries,
  subject: ForecastSubject,
  bucketMap: Record<string, CashModelBucketKey> = {}
): Record<string, number> {
  if (subject.kind === "category") {
    const label = subject.id?.trim();
    if (!label) return {};
    const months = categorySeries[label] ?? {};
    const out: Record<string, number> = {};
    for (const [m, cell] of Object.entries(months)) {
      out[monthKey(m)] = (cell.in ?? 0) - (cell.out ?? 0);
    }
    return out;
  }

  if (subject.kind === "bucket") {
    const bucket = subject.id?.trim() as CashModelBucketKey | undefined;
    if (!bucket) return {};
    const buckets = buildBucketSeries(categorySeries, bucketMap);
    return { ...(buckets[bucket] ?? {}) };
  }

  const totals: Record<string, { in: number; out: number }> = {};
  for (const months of Object.values(categorySeries)) {
    for (const [m, cell] of Object.entries(months)) {
      const k = monthKey(m);
      const row = totals[k] ?? { in: 0, out: 0 };
      row.in += cell.in ?? 0;
      row.out += cell.out ?? 0;
      totals[k] = row;
    }
  }

  const out: Record<string, number> = {};
  for (const [m, cell] of Object.entries(totals)) {
    if (subject.kind === "total_in") out[m] = cell.in;
    else if (subject.kind === "total_out") out[m] = cell.out;
    else out[m] = cell.in - cell.out;
  }
  return out;
}
