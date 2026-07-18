/** Analyze summit-ffm-0625.csv economics for Stage 10 regen. */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const csv = readFileSync(join(ROOT, "docs/summit-ffm-0625.csv"), "utf8")
  .trim()
  .split(/\r?\n/);

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

// Posted Date,Type,Description,Amount,Account,Notes,Balance,Raw Description
const rows = csv.slice(1).map((l) => {
  const p = parseLine(l);
  return {
    date: p[0]!,
    type: p[1]!,
    desc: p[2]!,
    amount: Number(p[3]),
    account: p[4]!,
    notes: p[5] ?? "",
    balance: Number(p[6]),
    raw: p[7] ?? "",
    line: l,
  };
});

console.log("rows", rows.length);
const types: Record<string, number> = {};
for (const r of rows) types[r.type] = (types[r.type] || 0) + 1;
console.log("types", types);

const payerRe =
  /SELECTHEALTH|REGENCE|UNITEDHEALTH|UNITED HEALTH|OPTUM|UNIVERSITY HEALT|BCBS|BLUE CROSS/i;
const payers = rows.filter((r) => payerRe.test(r.desc) && r.amount > 0);
const sh = rows.filter((r) => /SELECTHEALTH/i.test(r.desc));
console.log(
  "SELECTHEALTH",
  sh.length,
  "avg",
  (sh.reduce((s, r) => s + r.amount, 0) / sh.length).toFixed(2),
  "sum",
  sh.reduce((s, r) => s + r.amount, 0).toFixed(2)
);
console.log(
  "all payers+",
  payers.length,
  "sum",
  payers.reduce((s, r) => s + r.amount, 0).toFixed(2),
  "avg",
  (payers.reduce((s, r) => s + r.amount, 0) / payers.length).toFixed(2)
);

const check = rows.filter((r) => /\bCHECK\b/i.test(r.desc));
console.log("CHECK", check.length);

const big = [...rows]
  .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  .slice(0, 12);
console.log("\ntop abs amounts:");
for (const r of big) {
  console.log(r.date.slice(0, 10), r.type, r.amount.toFixed(2), r.desc.slice(0, 70));
}

const byMonth: Record<string, { in: number; out: number; n: number }> = {};
for (const r of rows) {
  const m = r.date.slice(0, 7);
  if (!byMonth[m]) byMonth[m] = { in: 0, out: 0, n: 0 };
  byMonth[m]!.n++;
  if (r.amount >= 0) byMonth[m]!.in += r.amount;
  else byMonth[m]!.out += r.amount;
}
const months = Object.keys(byMonth).sort();
let red = 0;
const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
console.log("\nmonths", months.length, months[0], "->", months[months.length - 1]);
console.log("totalIn", totalIn.toFixed(2));
for (const m of months) {
  const b = byMonth[m]!;
  const net = b.in + b.out;
  if (net < 0) red++;
  const share = b.in / totalIn;
  const flag = share > 0.4 ? " *** >40%" : share > 0.25 ? " (big)" : "";
  console.log(
    m,
    "in",
    b.in.toFixed(0),
    "out",
    b.out.toFixed(0),
    "net",
    net.toFixed(0),
    net < 0 ? "RED" : "ok",
    flag
  );
}
console.log("red months", red, "of", months.length);
