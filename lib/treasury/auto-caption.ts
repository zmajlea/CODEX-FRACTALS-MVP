import type { MetricSeries } from "@/lib/treasury/metrics-eval";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Spec B12 — deterministic caption pre-fill from MetricSeries envelope. */
export function autoCaption(series: MetricSeries | null | undefined): string {
  if (!series?.points?.length) return "";

  const values = series.points.map((p) => p.value);
  const avg =
    series.summary?.value ??
    values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minPt = series.points.find((p) => p.value === min);
  const maxPt = series.points.find((p) => p.value === max);
  const minLabel = minPt?.bucket_label ?? minPt?.bucket_start ?? "";
  const maxLabel = maxPt?.bucket_label ?? maxPt?.bucket_start ?? "";
  const windowEnd = series.window?.end ?? "";
  const partial = series.points.some((p) => p.partial);
  const breachCount =
    series.summary?.breach_count ??
    series.points.reduce((n, p) => n + (p.breaches?.length ?? 0), 0);

  const unit = series.unit === "usd" ? fmtMoney(avg) : `${avg}`;
  let s = `Averaged ${unit} over ${series.points.length} periods to ${windowEnd}`;
  if (minLabel && maxLabel) {
    s += `, ranging ${fmtMoney(min)} (${minLabel})–${fmtMoney(max)} (${maxLabel})`;
  }
  if (partial) s += "; latest period partial.";
  if (breachCount > 0) s += ` ${breachCount} reference breach(es).`;
  return s + ".";
}

export function autoCaptionValue(value: number, unit: string): string {
  const formatted =
    unit === "usd" ? fmtMoney(value) : `${value}${unit ? ` ${unit}` : ""}`;
  return `Current value: ${formatted}.`;
}
