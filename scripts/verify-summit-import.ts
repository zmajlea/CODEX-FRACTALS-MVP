/**
 * Parse-only verification for Summit FFM CSV imports.
 * Run: npx tsx scripts/verify-summit-import.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parseTreasuryCsv } from "../lib/treasury/csv-import";

const ROOT = join(__dirname, "..");
const CLIENT = "verify-client-id";

type Target = {
  file: string;
  rows: number;
  inflow: number;
  outflow: number;
  endBalance: number;
  account: string;
};

const TARGETS: Target[] = [
  {
    file: "docs/summit-ffm-0625.csv",
    rows: 1086,
    inflow: 193773,
    outflow: -156407,
    endBalance: 41547,
    account: "0625",
  },
  {
    file: "docs/summit-ffm-0617.csv",
    rows: 1121,
    inflow: 118409,
    outflow: -117669,
    endBalance: 3000,
    account: "0617",
  },
];

function near(a: number, b: number, tol = 1): boolean {
  return Math.abs(a - b) <= tol;
}

function verify(name: string, parsed: ReturnType<typeof parseTreasuryCsv>, t: Target) {
  const r = parsed.reconcile;
  const okRows = parsed.rows.length === t.rows;
  const okIn = near(r.inflowSum, t.inflow);
  const okOut = near(r.outflowSum, t.outflow);
  const end = r.endBalances[t.account];
  const okEnd = end != null && near(end, t.endBalance);
  const okDir = r.rowsNeedingDirection === 0;

  console.log(`\n=== ${name} ===`);
  console.log(`  rows: ${parsed.rows.length} (expected ${t.rows}) ${okRows ? "OK" : "FAIL"}`);
  console.log(
    `  inflows: $${r.inflowSum.toLocaleString()} (expected $${t.inflow.toLocaleString()}) ${okIn ? "OK" : "FAIL"}`
  );
  console.log(
    `  outflows: $${r.outflowSum.toLocaleString()} (expected $${t.outflow.toLocaleString()}) ${okOut ? "OK" : "FAIL"}`
  );
  console.log(
    `  end balance ${t.account}: $${end?.toLocaleString()} (expected $${t.endBalance.toLocaleString()}) ${okEnd ? "OK" : "FAIL"}`
  );
  console.log(`  unknown-direction skips: ${r.rowsNeedingDirection} ${okDir ? "OK" : "FAIL"}`);
  console.log(`  sign/type mismatches: ${r.signTypeMismatches}`);

  return okRows && okIn && okOut && okEnd && okDir;
}

let allOk = true;

for (const t of TARGETS) {
  const csv = readFileSync(join(ROOT, t.file), "utf8");
  const parsed = parseTreasuryCsv(csv, CLIENT);
  if (!verify(t.file, parsed, t)) allOk = false;

  // Idempotency: second parse same row count
  const again = parseTreasuryCsv(csv, CLIENT);
  if (again.rows.length !== parsed.rows.length) {
    console.log("  RE-PARSE row count mismatch FAIL");
    allOk = false;
  }
}

// Legacy demo
const demo = readFileSync(join(ROOT, "docs/demo-treasury-summit.csv"), "utf8");
const demoParsed = parseTreasuryCsv(demo, CLIENT);
console.log(`\n=== demo-treasury-summit.csv ===`);
console.log(`  rows: ${demoParsed.rows.length} (expected 496)`);
console.log(`  skipped: ${demoParsed.reconcile.skipped}`);
if (demoParsed.rows.length !== 496) allOk = false;

// Headerless
const headerless = demo.split("\n").slice(1).join("\n");
const hlParsed = parseTreasuryCsv(headerless, CLIENT, { accountLabel: "Operating" });
console.log(`\n=== headerless demo (account_label=Operating) ===`);
console.log(`  rows: ${hlParsed.rows.length}`);
console.log(`  headerless flag: ${hlParsed.reconcile.headerless}`);
if (!hlParsed.reconcile.headerless || hlParsed.rows.length < 1) allOk = false;

// Hash stability: same external_ids on re-parse
const ids1 = new Set(demoParsed.rows.map((r) => r.external_id));
const ids2 = new Set(parseTreasuryCsv(demo, CLIENT).rows.map((r) => r.external_id));
const sameIds =
  ids1.size === ids2.size && [...ids1].every((id) => ids2.has(id));
console.log(`\n=== demo hash stability ===`);
console.log(`  external_id set unchanged: ${sameIds ? "OK" : "FAIL"}`);
if (!sameIds) allOk = false;

// Transfer cross-check between summit files
const csv625 = readFileSync(join(ROOT, "docs/summit-ffm-0625.csv"), "utf8");
const csv617 = readFileSync(join(ROOT, "docs/summit-ffm-0617.csv"), "utf8");
const p625 = parseTreasuryCsv(csv625, CLIENT);
const p617 = parseTreasuryCsv(csv617, CLIENT);

function transferSum(rows: typeof p625.rows, account: string, dir: "in" | "out") {
  return rows
    .filter(
      (r) =>
        r.account_id === `csv:${account}` &&
        r.plaid_category === "transfer" &&
        ((dir === "in" && r.amount < 0) || (dir === "out" && r.amount > 0))
    )
    .reduce((s, r) => s + Math.abs(r.amount), 0);
}

const t617out = transferSum(p617.rows, "0617", "out");
const t625in = transferSum(p625.rows, "0625", "in");
console.log(`\n=== cross-account transfers ===`);
console.log(`  0617 transfer out: $${t617out.toLocaleString()}`);
console.log(`  0625 transfer in:  $${t625in.toLocaleString()}`);
console.log(`  match: ${near(t617out, t625in) && near(t617out, 114177) ? "OK" : "FAIL"}`);
if (!near(t617out, t625in, 1)) allOk = false;

console.log(allOk ? "\nAll checks passed." : "\nSome checks FAILED.");
process.exit(allOk ? 0 : 1);
