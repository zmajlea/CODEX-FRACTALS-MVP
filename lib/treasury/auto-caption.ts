import type { MetricSeries } from "@/lib/treasury/metrics-eval";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtMonthLabel(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})/);
  if (!m) return raw;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

function isMoneyUnit(unit: string | undefined): boolean {
  return unit === "usd" || unit === "amount" || unit === "$";
}

/** Spec B12/B13 — deterministic caption pre-fill from MetricSeries envelope. */
export function autoCaption(series: MetricSeries | null | undefined): string {
  if (!series?.points?.length) return "";

  const values = series.points.map((p) => p.value);
  const avgRaw =
    series.summary?.value ??
    values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const avg = isMoneyUnit(series.unit) ? Math.round(avgRaw) : Math.round(avgRaw * 100) / 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minPt = series.points.find((p) => p.value === min);
  const maxPt = series.points.find((p) => p.value === max);
  const minLabel = fmtMonthLabel(minPt?.bucket_label ?? minPt?.bucket_start ?? "");
  const maxLabel = fmtMonthLabel(maxPt?.bucket_label ?? maxPt?.bucket_start ?? "");
  const windowEnd = series.window?.end
    ? fmtMonthLabel(series.window.end.slice(0, 7))
    : "";
  const partial = series.points.some((p) => p.partial);
  const breachCount =
    series.summary?.breach_count ??
    series.points.reduce((n, p) => n + (p.breaches?.length ?? 0), 0);

  const unit = isMoneyUnit(series.unit) ? fmtMoney(avg) : `${avg}`;
  let s = `Averaged ${unit} over ${series.points.length} periods${windowEnd ? ` to ${windowEnd}` : ""}`;
  if (minLabel && maxLabel) {
    const minFmt = isMoneyUnit(series.unit) ? fmtMoney(min) : String(min);
    const maxFmt = isMoneyUnit(series.unit) ? fmtMoney(max) : String(max);
    s += `, ranging ${minFmt} (${minLabel})–${maxFmt} (${maxLabel})`;
  }
  if (partial) s += "; latest period partial";
  if (breachCount > 0) s += `; ${breachCount} reference breach${breachCount === 1 ? "" : "es"}`;
  return `${s}.`;
}

export function autoCaptionValue(value: number, unit: string): string {
  const formatted =
    isMoneyUnit(unit) ? fmtMoney(Math.round(value)) : `${value}${unit ? ` ${unit}` : ""}`;
  return `Current value: ${formatted}.`;
}
