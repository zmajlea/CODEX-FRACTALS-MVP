/**
 * Stage 2 gates: allowlist params; txquery is one evidence item; buildTxPredicate only.
 * Run: npx tsx scripts/check-stage2-batch-a.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { evidenceFromPickable } from "../lib/treasury/evidence";
import { assertAbsolutePickParams } from "../lib/treasury/pickable";

const ROOT = join(__dirname, "..");

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

// Allowlist: tomorrow's presets must fail without being enumerated as special cases
for (const bad of ["trailing6", "qtd", "last12", "ytd", "mtd", "12m"]) {
  try {
    assertAbsolutePickParams({ from: bad });
    fail(`expected reject relative from=${bad}`);
  } catch {
    /* expected */
  }
}

try {
  assertAbsolutePickParams({
    from: "2025-08-01",
    to: "2026-07-17",
    q: "SELECTHEALTH",
    status: "all",
  });
} catch (e) {
  fail(`absolute params should pass: ${e instanceof Error ? e.message : e}`);
}

// Namespaced / short account ids (csv:EU-Supplier, csv:0625, csv:1, plaid:uuid.with.dots)
for (const accountId of [
  "csv:EU-Supplier",
  "csv:0625",
  "csv:1",
  "plaid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
]) {
  try {
    assertAbsolutePickParams({
      month: "2025-06",
      accountId,
      from: "2025-06-01",
      to: "2025-06-30",
    });
  } catch (e) {
    fail(
      `namespaced accountId should pass (${accountId}): ${e instanceof Error ? e.message : e}`
    );
  }
}

// One filtered view → one evidence item (not N transaction refs)
const pickable = {
  kind: "txquery" as const,
  params: {
    from: "2025-01-01",
    to: "2025-12-31",
    q: "SELECTHEALTH",
    status: "all" as const,
  },
  label: "244 transactions · SELECTHEALTH",
};
const item = evidenceFromPickable(pickable);
if (item.kind !== "txquery") fail(`expected txquery, got ${item.kind}`);
if (!("params" in item) || item.params.q !== "SELECTHEALTH") {
  fail("txquery must store absolute params, not row ids");
}

const evidenceSrc = readFileSync(
  join(ROOT, "lib/treasury/evidence.ts"),
  "utf8"
);
if (!evidenceSrc.includes("buildTxPredicate")) {
  fail("evidence.ts must call buildTxPredicate for txquery");
}
if (
  evidenceSrc.includes('.eq("suggestion_status"') ||
  evidenceSrc.includes("suggestion_status.neq.suggested")
) {
  fail("evidence.ts must not hand-assemble transaction WHERE");
}

const predSrc = readFileSync(
  join(ROOT, "lib/treasury/tx-predicate.ts"),
  "utf8"
);
if (!predSrc.includes("export const buildTxPredicate = applyTxPredicate")) {
  fail("buildTxPredicate must alias applyTxPredicate (one builder)");
}

console.log(
  "OK: Stage 2 — allowlist params; txquery → 1 item; buildTxPredicate is the sole WHERE"
);
