import type { SummaryBucket } from "@/lib/treasury/types";

function parseIsoDate(iso: string): Date {
  return new Date(iso + "T12:00:00Z");
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

/** End of summary bucket period (inclusive), from period_start. */
export function periodEnd(bucket: SummaryBucket, periodStart: string): string {
  if (bucket === "day") return periodStart;
  if (bucket === "week") return addDays(periodStart, 6);
  if (bucket === "month") {
    const d = parseIsoDate(periodStart);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return formatIsoDate(last);
  }
  const year = parseIsoDate(periodStart).getUTCFullYear();
  return `${year}-12-31`;
}

export function periodLabel(bucket: SummaryBucket, periodStart: string): string {
  const d = parseIsoDate(periodStart);
  if (bucket === "day") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  }
  if (bucket === "week") {
    const end = parseIsoDate(periodEnd(bucket, periodStart));
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
    return `${fmt.format(d)} – ${fmt.format(end)}`;
  }
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
  }
  return String(d.getUTCFullYear());
}

export function todayIso(): string {
  return formatIsoDate(new Date());
}

export function subtractMonths(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  d.setUTCMonth(d.getUTCMonth() - months);
  return formatIsoDate(d);
}

export function subtractDays(iso: string, days: number): string {
  return addDays(iso, -days);
}

export function defaultDateRange(): { from: string; to: string; preset: "12m" } {
  const to = todayIso();
  return { from: subtractMonths(to, 12), to, preset: "12m" };
}

export function bucketForPreset(preset: string): SummaryBucket {
  if (preset === "7d" || preset === "30d") return "day";
  if (preset === "3m") return "week";
  return "month";
}

export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from).getTime();
  const b = parseIsoDate(to).getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1);
}

export function shiftRange(from: string, to: string, direction: -1 | 1): { from: string; to: string } {
  const span = daysBetween(from, to);
  if (direction === -1) {
    return { from: subtractDays(from, span), to: subtractDays(to, span) };
  }
  const today = todayIso();
  let newTo = addDays(to, span);
  if (newTo > today) newTo = today;
  const newFrom = subtractDays(newTo, span - 1);
  return { from: newFrom, to: newTo };
}

export function startOfMonth(iso: string): string {
  const d = parseIsoDate(iso);
  return formatIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function addMonths(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return formatIsoDate(d);
}

export function compareIso(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isBetweenIso(date: string, from: string, to: string): boolean {
  return compareIso(date, from) >= 0 && compareIso(date, to) <= 0;
}

export function formatRangeLabel(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(parseIsoDate(from))} – ${fmt.format(parseIsoDate(to))}`;
}

export function monthTitle(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, monthIndex, 1))
  );
}

/** Monday-first grid cells (null = padding). */
export function monthGridCells(year: number, monthIndex: number): (string | null)[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(formatIsoDate(new Date(Date.UTC(year, monthIndex, day))));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Start of the summary period containing `iso` (week = Monday, month = 1st). */
export function periodStartOf(bucket: SummaryBucket, iso: string): string {
  const d = parseIsoDate(iso);
  if (bucket === "day") return iso.slice(0, 10);
  if (bucket === "week") {
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    return formatIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)));
  }
  if (bucket === "month") {
    return formatIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  }
  return `${d.getUTCFullYear()}-01-01`;
}

/** Shift a period start by `delta` whole periods (negative = earlier). */
export function shiftPeriods(bucket: SummaryBucket, periodStart: string, delta: number): string {
  if (bucket === "day") return addDays(periodStart, delta);
  if (bucket === "week") return addDays(periodStart, delta * 7);
  if (bucket === "month") return addMonths(periodStart, delta);
  const d = parseIsoDate(periodStart);
  d.setUTCFullYear(d.getUTCFullYear() + delta);
  return formatIsoDate(d);
}

/** Inclusive list of period starts from `from` through `to`. */
export function listPeriodStarts(bucket: SummaryBucket, from: string, to: string): string[] {
  const starts: string[] = [];
  let cur = periodStartOf(bucket, from);
  const end = periodStartOf(bucket, to);
  while (compareIso(cur, end) <= 0) {
    starts.push(cur);
    cur = shiftPeriods(bucket, cur, 1);
  }
  return starts;
}

export function lastNPeriodStarts(bucket: SummaryBucket, n: number): { from: string; to: string; starts: string[] } {
  const clamped = Math.min(Math.max(n, 1), 60);
  const to = todayIso();
  const anchor = periodStartOf(bucket, to);
  const from = shiftPeriods(bucket, anchor, -(clamped - 1));
  const starts: string[] = [];
  for (let i = 0; i < clamped; i++) {
    starts.push(shiftPeriods(bucket, from, i));
  }
  return { from, to, starts };
}
