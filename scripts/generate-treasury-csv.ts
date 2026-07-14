/**
 * Generates a 18-month demo CSV for Tim-style treasury review.
 * Usage: npx tsx scripts/generate-treasury-csv.ts > demo-treasury.csv
 */
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function addDays(iso: string, days: number) {
  const dt = new Date(iso + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const start = new Date();
start.setUTCMonth(start.getUTCMonth() - 18);

let balance = 85000;
const rows: string[] = [
  "posted_date,type,amount,balance,description,account,currency",
];

let cursor = start.toISOString().slice(0, 10);

while (cursor <= new Date().toISOString().slice(0, 10)) {
  const dt = new Date(cursor + "T12:00:00Z");
  const day = dt.getUTCDate();
  const month = dt.getUTCMonth() + 1;
  const year = dt.getUTCFullYear();

  // Jittered monthly rent (1st–5th)
  if (day >= 1 && day <= 5 && day === ((month + year) % 5) + 1) {
    const rent = 4200 + (month % 3) * 50;
    balance -= rent;
    rows.push(
      `${cursor},debit,${rent.toFixed(2)},${balance.toFixed(2)},ACH DEBIT BIRCHWOOD PROPERTIES RENT,Operating,USD`
    );
  }

  // Biweekly payroll (Fridays)
  if (dt.getUTCDay() === 5 && day % 14 < 7) {
    const payroll = 18500;
    balance -= payroll;
    rows.push(
      `${cursor},debit,${payroll.toFixed(2)},${balance.toFixed(2)},ACH PAYROLL ADP WAGE PMT,Operating,USD`
    );
  }

  // Monthly insurance (~10th)
  if (day === 10) {
    const ins = 890;
    balance -= ins;
    rows.push(
      `${cursor},debit,${ins.toFixed(2)},${balance.toFixed(2)},INSURANCE HARTFORD COMM POLICY,Operating,USD`
    );
  }

  // Weekly fuel (Wednesdays)
  if (dt.getUTCDay() === 3) {
    const fuel = 120 + (day % 40);
    balance -= fuel;
    rows.push(
      `${cursor},debit,${fuel.toFixed(2)},${balance.toFixed(2)},POS SHELL OIL #4421,Operating,USD`
    );
  }

  // Irregular steel buys
  if (day === 17 && month % 2 === 0) {
    const steel = 45000 + (month % 5) * 2000;
    balance -= steel;
    rows.push(
      `${cursor},debit,${steel.toFixed(2)},${balance.toFixed(2)},WIRE OUT MIDWEST STEEL SUPPLY,Operating,USD`
    );
  }

  // Monthly AR (~25th)
  if (day === 25) {
    const ar = 28000 + month * 500;
    balance += ar;
    rows.push(
      `${cursor},credit,${ar.toFixed(2)},${balance.toFixed(2)},WIRE IN ACME CORP PAYMENT,Operating,USD`
    );
  }

  cursor = addDays(cursor, 1);
}

const outPath = resolve(__dirname, "../docs/treasury-demo-18mo.csv");
writeFileSync(outPath, rows.join("\n") + "\n", "utf8");
console.log(`Wrote ${rows.length - 1} rows to ${outPath}`);
