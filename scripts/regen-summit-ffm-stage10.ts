/**
 * Stage 10 — reshape summit-ffm-0625.csv so the Summary looks alive.
 *
 * - Cap the freak ~$95k transfer to a normal transfer size
 * - Scale insurance/payer deposits to dominate inflow
 * - Rebuild Balance as running total (as-stated)
 * - Keep row count, types, SELECTHEALTH count, date span
 * - Sync public/docs copy
 *
 * AL Finance spend-plan fixtures are untouched.
 *
 * Run: npx tsx scripts/regen-summit-ffm-stage10.ts
 */
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "docs/summit-ffm-0625.csv");
const PUBLIC = join(ROOT, "public/docs/summit-ffm-0625.csv");

const PAYER_RE =
  /SELECTHEALTH|REGENCE|UNITEDHEALTH|UNITED HEALTH|OPTUM|UNIVERSITY HEALT|BCBS|BLUE CROSS|HCCLAIMPMT/i;

const FREAK_CAP = 1200; // normal-sized transfer after cap
const PAYER_SCALE = 2.85; // ~$145 → ~$413 avg claim
/** Mild lumpiness: one soft + one strong calendar month (YYYY-MM). */
const SOFT_MONTH = "2025-04";
const STRONG_MONTH = "2025-10";
const SOFT_FACTOR = 0.72;
const STRONG_FACTOR = 1.28;

function parseLine(l: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i]!;
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function joinLine(parts: string[]): string {
  return parts
    .map((p) => {
      if (/[",\n\r]/.test(p)) return `"${p.replace(/"/g, '""')}"`;
      return p;
    })
    .join(",");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const raw = readFileSync(SRC, "utf8");
const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
const header = lines[0]!;
const headerCols = parseLine(header);

const idx = {
  date: headerCols.findIndex((c) => /posted\s*date/i.test(c)),
  type: headerCols.findIndex((c) => /^type$/i.test(c)),
  desc: headerCols.findIndex((c) => /^description$/i.test(c)),
  amount: headerCols.findIndex((c) => /^amount$/i.test(c)),
  balance: headerCols.findIndex((c) => /^balance$/i.test(c)),
};

if (Object.values(idx).some((i) => i < 0)) {
  throw new Error(`Missing columns in header: ${header}`);
}

type Row = { parts: string[]; amount: number; type: string; desc: string; date: string };

const rows: Row[] = lines.slice(1).map((l) => {
  const parts = parseLine(l);
  return {
    parts,
    amount: Number(parts[idx.amount]!.replace(/,/g, "")),
    type: parts[idx.type]!,
    desc: parts[idx.desc]!,
    date: parts[idx.date]!,
  };
});

if (rows.length !== 1086) {
  throw new Error(`Expected 1086 rows, got ${rows.length}`);
}

const shBefore = rows.filter((r) => /SELECTHEALTH/i.test(r.desc)).length;

// Opening balance = first row's balance − first amount
const firstBal = Number(rows[0]!.parts[idx.balance]!.replace(/,/g, ""));
let running = round2(firstBal - rows[0]!.amount);

let cappedFreak = false;
let payerScaled = 0;

for (const r of rows) {
  let amt = r.amount;

  // Cap freak transfer-in
  if (
    r.type === "transfer" &&
    amt > 20_000 &&
    /TRSFR FR ACC|TRANSFER FROM/i.test(r.desc)
  ) {
    amt = FREAK_CAP;
    cappedFreak = true;
  }

  // Scale payer deposits (positive insurance stream)
  if (amt > 0 && (r.type === "deposit" || PAYER_RE.test(r.desc))) {
    if (PAYER_RE.test(r.desc)) {
      let factor = PAYER_SCALE;
      const ym = r.date.slice(0, 7);
      if (ym === SOFT_MONTH) factor *= SOFT_FACTOR;
      if (ym === STRONG_MONTH) factor *= STRONG_FACTOR;
      amt = round2(amt * factor);
      payerScaled += 1;
    }
  }

  r.amount = amt;
  r.parts[idx.amount!] = amt.toFixed(2);
  running = round2(running + amt);
  r.parts[idx.balance!] = running.toFixed(2);
}

if (!cappedFreak) {
  throw new Error("Expected to cap one freak transfer — none found >$20k");
}

const outLines = [header, ...rows.map((r) => joinLine(r.parts))];
const out = outLines.join("\n") + "\n";
writeFileSync(SRC, out, "utf8");
copyFileSync(SRC, PUBLIC);

const shAfter = rows.filter((r) => /SELECTHEALTH/i.test(r.desc)).length;
const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
const totalOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
const endBal = Number(rows[rows.length - 1]!.parts[idx.balance!]);

const byMonth: Record<string, { in: number; out: number }> = {};
for (const r of rows) {
  const m = r.date.slice(0, 7);
  if (!byMonth[m]) byMonth[m] = { in: 0, out: 0 };
  if (r.amount >= 0) byMonth[m]!.in += r.amount;
  else byMonth[m]!.out += r.amount;
}
const months = Object.keys(byMonth).sort();
let red = 0;
let maxShare = 0;
let maxMonth = "";
for (const m of months) {
  const b = byMonth[m]!;
  const net = b.in + b.out;
  if (net < 0) red++;
  const share = b.in / totalIn;
  if (share > maxShare) {
    maxShare = share;
    maxMonth = m;
  }
}

console.log("Stage 10 regen complete");
console.log(`  rows: ${rows.length}`);
console.log(`  SELECTHEALTH: ${shBefore} → ${shAfter}`);
console.log(`  payer rows scaled: ${payerScaled}`);
console.log(`  freak transfer capped to $${FREAK_CAP}`);
console.log(`  inflows: $${totalIn.toFixed(2)}`);
console.log(`  outflows: $${totalOut.toFixed(2)}`);
console.log(`  end balance: $${endBal.toFixed(2)}`);
console.log(`  red months: ${red} of ${months.length}`);
console.log(
  `  max month inflow share: ${(maxShare * 100).toFixed(1)}% (${maxMonth})`
);

if (shAfter !== 244) {
  throw new Error(`SELECTHEALTH count drifted: ${shAfter}`);
}
if (maxShare > 0.4) {
  throw new Error(`Month ${maxMonth} is ${(maxShare * 100).toFixed(1)}% of inflow (>40%)`);
}
if (red > months.length * 0.45) {
  throw new Error(`Too many red months: ${red}/${months.length}`);
}

console.log("\nUpdate verify TARGETS to:");
console.log(
  JSON.stringify(
    {
      rows: rows.length,
      inflow: Math.round(totalIn),
      outflow: Math.round(totalOut),
      endBalance: Math.round(endBal),
    },
    null,
    2
  )
);
