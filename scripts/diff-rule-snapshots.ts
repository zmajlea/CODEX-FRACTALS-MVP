/**
 * Diff two suggestion snapshots (Spec 30 / Spec 31).
 *
 * Usage:
 *   npx tsx scripts/diff-rule-snapshots.ts snapshots/spec30-a.json snapshots/spec30-b.json
 *
 * Primary key: external_id when present on all rows; legacy snapshots fall back to label+explanation.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { SuggestionSnapshotRow } from "./snapshot-rule-suggestions";

const ROOT = join(__dirname, "..");

type Row = SuggestionSnapshotRow & { external_id?: string };

function load(path: string): Row[] {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Row[];
}

function legacyKey(row: Row): string {
  return `${row.suggested_label ?? ""}\0${row.suggestion_explanation ?? ""}`;
}

function rowKey(row: Row, useExternalId: boolean): string {
  if (useExternalId && row.external_id) return row.external_id;
  return legacyKey(row);
}

function diffByKey(a: Row[], b: Row[]): number {
  const useExternalId =
    a.every((r) => r.external_id) && b.every((r) => r.external_id);
  const keyLabel = useExternalId ? "external_id" : "label+explanation";

  const aByKey = new Map(a.map((r) => [rowKey(r, useExternalId), r]));
  const bByKey = new Map(b.map((r) => [rowKey(r, useExternalId), r]));
  let mismatches = 0;
  const allKeys = new Set([...aByKey.keys(), ...bByKey.keys()]);

  for (const key of [...allKeys].sort()) {
    const ra = aByKey.get(key);
    const rb = bByKey.get(key);
    if (!ra || !rb) {
      mismatches += 1;
      console.log(`MISSING (${keyLabel}): ${key} in ${!ra ? "A" : "B"}`);
      continue;
    }
    if (ra.suggested_label !== rb.suggested_label) {
      mismatches += 1;
      console.log(
        `DIFF ${key}.suggested_label:\n  A: ${ra.suggested_label}\n  B: ${rb.suggested_label}`
      );
    }
    if (ra.suggestion_explanation !== rb.suggestion_explanation) {
      mismatches += 1;
      console.log(
        `DIFF ${key}.suggestion_explanation:\n  A: ${ra.suggestion_explanation}\n  B: ${rb.suggestion_explanation}`
      );
    }
  }

  return mismatches;
}

function main() {
  const [aPath, bPath] = process.argv.slice(2);
  if (!aPath || !bPath) {
    console.error("Usage: diff-rule-snapshots.ts <a.json> <b.json>");
    process.exit(1);
  }

  const a = load(aPath);
  const b = load(bPath);
  const useExternalId =
    a.every((r) => r.external_id) && b.every((r) => r.external_id);
  const mismatches = diffByKey(a, b);

  if (mismatches === 0) {
    const keyLabel = useExternalId ? "external_id" : "label+explanation";
    console.log(
      `PASS: ${a.length} rows — suggested_label + suggestion_explanation match (key=${keyLabel})`
    );
  } else {
    console.log(`\nFAIL: ${mismatches} mismatch(es) (A=${a.length}, B=${b.length})`);
    process.exit(1);
  }
}

main();
