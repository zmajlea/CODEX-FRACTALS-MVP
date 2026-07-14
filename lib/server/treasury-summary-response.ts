import type { SummaryGranularity, TreasurySummaryRow } from "@/lib/treasury/types";

export function parseSummaryGranularity(url: URL): SummaryGranularity {
  const g = url.searchParams.get("granularity") ?? url.searchParams.get("bucket") ?? "month";
  if (g === "day" || g === "week" || g === "month") return g;
  return "month";
}

export function clampSummaryPeriods(raw: string | null): number {
  return Math.min(Math.max(Number(raw ?? 12), 1), 60);
}

export function zeroFillPrimary(
  sparse: TreasurySummaryRow[],
  periodStarts: string[],
  primaryCurrency: string
): TreasurySummaryRow[] {
  const byPeriod = new Map(
    sparse.filter((r) => r.iso_currency_code === primaryCurrency).map((r) => [r.period_start, r])
  );
  return periodStarts.map((period_start) => {
    const existing = byPeriod.get(period_start);
    if (existing) return existing;
    return {
      period_start,
      iso_currency_code: primaryCurrency,
      inflow: 0,
      outflow: 0,
      net: 0,
      count: 0,
    };
  });
}

export function pickPrimaryCurrency(sparse: TreasurySummaryRow[]): string {
  const currencyCounts = new Map<string, number>();
  for (const row of sparse) {
    currencyCounts.set(
      row.iso_currency_code,
      (currencyCounts.get(row.iso_currency_code) ?? 0) + row.count
    );
  }
  let primaryCurrency = "USD";
  let maxCount = 0;
  for (const [cur, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count;
      primaryCurrency = cur;
    }
  }
  return primaryCurrency;
}

export function buildSummaryResponse(
  sparse: TreasurySummaryRow[],
  opts: {
    granularity: SummaryGranularity;
    periods: number;
    from: string;
    to: string;
    starts: string[];
  }
) {
  const primaryCurrency = pickPrimaryCurrency(sparse);
  const rows = zeroFillPrimary(sparse, opts.starts, primaryCurrency);
  const other_rows = sparse
    .filter((r) => r.iso_currency_code !== primaryCurrency)
    .sort((a, b) => b.period_start.localeCompare(a.period_start));

  return {
    granularity: opts.granularity,
    periods: opts.periods,
    from: opts.from,
    to: opts.to,
    primary_currency: primaryCurrency,
    rows,
    other_rows,
  };
}
