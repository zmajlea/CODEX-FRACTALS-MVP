/**
 * Spec 68 gate — Cash Model + Rules visual reshape (presentation only).
 * Usage: npx tsx scripts/gate-spec68-reshape.ts
 *
 * 1. Re-run Spec 65 / 65-R and Spec 66 functional gates (prove pixels-only).
 * 2. Hex scan on Spec 68 touch files (no hardcoded #rrggbb in markup/styles we own).
 * 3. White-label: Spec 68 CSS block uses tokens only; both summit + fractals brands declare them.
 * 4. npm run build.
 * 5. Manual visual checklist printed for Tim/Leander.
 */
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const TOUCH_FILES = [
  "components/operator/treasury/TreasuryCashModelPanel.tsx",
  "components/operator/treasury/cash-model/CashModelRunwayChart.tsx",
  "components/operator/treasury/cash-model/CashModelLiquiditySummary.tsx",
  "components/operator/treasury/cash-model/CashModelCoverageMeter.tsx",
  "components/operator/treasury/cash-model/CashModelExplainChart.tsx",
  "components/operator/treasury/cash-model/CashModelCategoryDivisionCard.tsx",
  "components/operator/treasury/cash-model/CashModelRunwayChip.tsx",
  "components/operator/treasury/RuleAmountAnalyzePopup.tsx",
];

const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/;
/** Inline fallbacks like var(--x,#E67E50) — Spec 68 forbids these in touch files. */
const VAR_HEX_FALLBACK_RE = /var\(\s*--[^,)]+\s*,\s*#[0-9A-Fa-f]{3,8}/;

function log(msg: string) {
  console.log(`[gate68] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function runGate(label: string, script: string) {
  log(`re-run ${label}…`);
  execSync(`npx tsx ${script}`, { cwd: ROOT, stdio: "inherit" });
  log(`${label} PASS`);
}

function scanHex() {
  const hits: string[] = [];
  for (const rel of TOUCH_FILES) {
    const path = join(ROOT, rel);
    assert(existsSync(path), `missing touch file ${rel}`);
    const src = readFileSync(path, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (HEX_RE.test(line) || VAR_HEX_FALLBACK_RE.test(line)) {
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert(hits.length === 0, `hardcoded hex in Spec 68 touch files:\n${hits.join("\n")}`);
  log(`hex scan PASS (${TOUCH_FILES.length} files)`);
}

function scanSpec68CssBlock() {
  const cssPath = join(ROOT, "app/styles/summit-r1.css");
  const css = readFileSync(cssPath, "utf8");
  const marker = "Spec 68 — Cash Model + Rules visual reshape";
  const idx = css.indexOf(marker);
  assert(idx >= 0, "Spec 68 block missing from summit-r1.css (append by hand — do not regenerate)");
  const block = css.slice(idx);
  // Brand token tables above Spec 68 legitimately contain hex; scan only the Spec 68 append.
  const hexInBlock = block.match(HEX_RE);
  assert(
    !hexInBlock,
    `Spec 68 CSS block contains hardcoded hex: ${hexInBlock?.slice(0, 5).join(", ")}`
  );
  assert(
    block.includes("do NOT regenerate"),
    "Spec 68 CSS must warn against regenerating via namespace-summit-r1.mjs"
  );

  // White-label: required tokens referenced by Spec 68 must exist under both brands.
  const required = [
    "--su-neg",
    "--su-warn",
    "--brand",
    "--brand-2",
    "--paper",
    "--line",
    "--mute",
    "--ink",
    "--scrim",
  ];
  for (const brand of ["summit", "fractals"] as const) {
    const re = new RegExp(`\\[data-brand="${brand}"\\]\\s*\\{([^}]+)\\}`, "m");
    const m = css.match(re);
    assert(m, `[data-brand="${brand}"] block missing`);
    for (const tok of required) {
      assert(
        m[1]!.includes(tok),
        `white-label: ${tok} missing under [data-brand="${brand}"]`
      );
    }
  }
  log("white-label token check PASS (summit + fractals)");
}

function printVisualChecklist() {
  console.log(`
=== Spec 68 manual visual checklist (vs R2 guide) ===
[ ] Assumptions control card: Base | Downside | Selected seg + dials + quick actions
[ ] Selected is visual state (dial edit mutates active scenario; Reset to Base recovers)
[ ] Runway headline + sub-line above chart
[ ] Chart: today divider · threshold label · breach marker · caption
[ ] Cascade: Month · Beginning · Collections · Payroll · Opex · Other Out · Net · Ending
[ ] Liquidity KPI tiles + collections one-liner (no duplicate chart)
[ ] Coverage / by-bucket / Rules CTA air
[ ] Rules popup: 3-col · Identity/Amount/Time · bars · promise line
[ ] data-brand=fractals (or non-Summit): Cash Model + popup re-theme, no leaked hex
`);
}

function main() {
  scanHex();
  scanSpec68CssBlock();

  // Functional gates prove breach months / counts unchanged.
  runGate("Spec 65 / 65-R", "scripts/gate-spec65-cash-model.ts");
  runGate("Spec 66", "scripts/gate-spec66-rule-creator.ts");

  log("npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  log("build PASS");

  printVisualChecklist();
  console.log("\n=== Spec 68 gate summary ===");
  console.log("✓ hex scan (touch files)");
  console.log("✓ Spec 68 CSS block token-only + brand tokens");
  console.log("✓ Spec 65 / 65-R functional gate");
  console.log("✓ Spec 66 functional gate");
  console.log("✓ npm run build");
  log("ALL PASS — push fix/cashmodel-reshape · STOP — no merge");
}

main();
