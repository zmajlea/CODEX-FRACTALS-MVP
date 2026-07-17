/**
 * Spec 36 review test: Transactions WHERE must assemble only via applyTxPredicate.
 * Chip counts call the same builder with a different status arg — that is fine.
 *
 * Run: npx tsx scripts/verify-tx-predicate.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { withStatus, type TxFilterInput } from "../lib/treasury/tx-predicate";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk(join(ROOT, "app")).concat(walk(join(ROOT, "lib")))) {
  if (file.replace(/\\/g, "/").endsWith("lib/treasury/tx-predicate.ts")) continue;
  const text = readFileSync(file, "utf8");
  // Second assembly smell: hand-rolled suggestion_status / needs_label OR on treasury_transactions
  // outside applyTxPredicate, for the operator transactions surface.
  if (!file.replace(/\\/g, "/").includes("transactions/route.ts")) continue;
  const withoutImport = text.replace(
    /from ["']@\/lib\/treasury\/tx-predicate["']/g,
    ""
  );
  if (
    withoutImport.includes('.eq("suggestion_status"') ||
    withoutImport.includes("suggestion_status.neq.suggested") ||
    withoutImport.includes("label.is.null,suggestion_status")
  ) {
    offenders.push(file);
  }
}

if (!textHasApply(join(ROOT, "app/api/operator/treasury/clients/[clientId]/transactions/route.ts"))) {
  console.error("FAIL: transactions route does not call applyTxPredicate");
  process.exit(1);
}

if (offenders.length) {
  console.error(
    "FAIL: transactions route still hand-assembles status WHERE (use applyTxPredicate only):\n",
    offenders.join("\n")
  );
  process.exit(1);
}

const base: TxFilterInput = {
  from: "2024-01-01",
  to: "2026-01-01",
  q: "SELECTHEALTH",
  status: "all",
};
const suggested = withStatus(base, "suggested");
if (suggested.status !== "suggested" || suggested.q !== "SELECTHEALTH") {
  console.error("FAIL: withStatus must swap only the status dimension");
  process.exit(1);
}
if (suggested.from !== base.from || suggested.to !== base.to) {
  console.error("FAIL: withStatus must preserve other filters");
  process.exit(1);
}

console.log("OK: applyTxPredicate is the sole Transactions WHERE builder; withStatus swaps status only");

function textHasApply(path: string): boolean {
  return readFileSync(path, "utf8").includes("applyTxPredicate");
}
