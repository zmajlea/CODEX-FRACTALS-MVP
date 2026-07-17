/**
 * Stage 0 one-shot: shift summit-ffm-0625 Posted Date by +147 days.
 * Preserves weekdays (147 = 21 weeks). Leaves Amount/Balance/Description untouched
 * by rewriting only the leading Posted Date field (no full CSV re-serialize).
 * Run once: npx tsx scripts/shift-summit-ffm-0625-dates.ts
 */
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const OFFSET_DAYS = 147;
const SRC = join(ROOT, "docs/summit-ffm-0625.csv");
const PUBLIC = join(ROOT, "public/docs/summit-ffm-0625.csv");

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([^,]*)/;

function shiftPostedDate(raw: string, days: number): string {
  const m = raw.match(DATE_RE);
  if (!m) throw new Error(`Unexpected Posted Date format: ${raw}`);
  const [, y, mo, d, hh, mm, ss, rest] = m;
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d) + days,
    Number(hh),
    Number(mm),
    Number(ss)
  );
  const dt = new Date(utc);
  const Y = dt.getUTCFullYear();
  const M = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const D = String(dt.getUTCDate()).padStart(2, "0");
  const H = String(dt.getUTCHours()).padStart(2, "0");
  const Min = String(dt.getUTCMinutes()).padStart(2, "0");
  const S = String(dt.getUTCSeconds()).padStart(2, "0");
  return `${Y}-${M}-${D}T${H}:${Min}:${S}${rest}`;
}

function weekdayCounts(dates: string[]): { weekday: number; weekend: number } {
  let weekday = 0;
  let weekend = 0;
  for (const raw of dates) {
    const day = raw.slice(0, 10);
    const dow = new Date(day + "T12:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6) weekend += 1;
    else weekday += 1;
  }
  return { weekday, weekend };
}

const text = readFileSync(SRC, "utf8");
const newline = text.includes("\r\n") ? "\r\n" : "\n";
const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

const header = lines[0]!;
if (!header.startsWith("Posted Date,")) {
  throw new Error(`Unexpected header: ${header.slice(0, 40)}`);
}

const beforeDates: string[] = [];
const afterDates: string[] = [];
const outLines = [header];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i]!;
  if (!line.trim()) continue;
  const comma = line.indexOf(",");
  if (comma < 0) throw new Error(`No comma on line ${i + 1}`);
  const before = line.slice(0, comma);
  const after = shiftPostedDate(before, OFFSET_DAYS);
  beforeDates.push(before);
  afterDates.push(after);
  outLines.push(after + line.slice(comma));
}

const out = outLines.join(newline) + newline;
writeFileSync(SRC, out, "utf8");
copyFileSync(SRC, PUBLIC);

const wdBefore = weekdayCounts(beforeDates);
const wdAfter = weekdayCounts(afterDates);
const firstBefore = beforeDates[0]!.slice(0, 10);
const lastBefore = beforeDates[beforeDates.length - 1]!.slice(0, 10);
const firstAfter = afterDates[0]!.slice(0, 10);
const lastAfter = afterDates[afterDates.length - 1]!.slice(0, 10);

console.log(`Shifted ${beforeDates.length} rows by +${OFFSET_DAYS} days`);
console.log(`  before: ${firstBefore} → ${lastBefore}`);
console.log(`  after:  ${firstAfter} → ${lastAfter}`);
console.log(`  weekdays before: ${wdBefore.weekday} weekend: ${wdBefore.weekend}`);
console.log(`  weekdays after:  ${wdAfter.weekday} weekend: ${wdAfter.weekend}`);
console.log(`  wrote ${SRC}`);
console.log(`  wrote ${PUBLIC}`);

if (lastAfter !== "2026-07-10") {
  console.error(`FAIL: expected last calendar day 2026-07-10, got ${lastAfter}`);
  process.exit(1);
}
if (firstAfter !== "2024-05-28") {
  console.error(`FAIL: expected first calendar day 2024-05-28, got ${firstAfter}`);
  process.exit(1);
}
if (wdAfter.weekday !== wdBefore.weekday || wdAfter.weekend !== wdBefore.weekend) {
  console.error("FAIL: weekday distribution changed");
  process.exit(1);
}
console.log("OK");
