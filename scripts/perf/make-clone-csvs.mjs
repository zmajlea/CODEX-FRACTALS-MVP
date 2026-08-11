/**
 * Build Account-rewritten CSV clones so external_id hashes differ.
 * Usage: node scripts/perf/make-clone-csvs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(join(ROOT, "docs/summit-ffm-0625.csv"), "utf8");
const outDir = join(ROOT, "scripts/perf/clones");
mkdirSync(outDir, { recursive: true });

const lines = src.split(/\r?\n/);
const header = lines[0];
const data = lines.slice(1).filter((l) => l.trim());

/** 1 original account + 6 clones ≈ 7 × ~1086 ≈ 7600 rows */
const suffixes = ["b", "c", "d", "e", "f", "g"];
for (const suf of suffixes) {
  const acct = `0625-${suf}`;
  const out = [
    header,
    ...data.map((line) => {
      // Account column is 5th CSV field (index 4) for headed FFM file
      // Posted Date,Type,Description,Amount,Account,...
      const cols = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQ = !inQ;
          cur += ch;
          continue;
        }
        if (ch === "," && !inQ) {
          cols.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      cols.push(cur);
      if (cols.length >= 5) cols[4] = acct;
      return cols.join(",");
    }),
  ].join("\n");
  const path = join(outDir, `summit-ffm-0625-${suf}.csv`);
  writeFileSync(path, out + "\n");
  console.log(`wrote ${path} account=${acct} rows=${data.length}`);
}
console.log("done");
