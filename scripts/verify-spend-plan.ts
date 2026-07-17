/**
 * Tim's spend-plan fixture validation (Spec 25 + Spec 28 Day 1).
 * Run: npm run treasury:verify-spend-plan
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  allocationForMonth,
  backtestSpendPlan,
  buildDefaultScenarios,
  buildSpendPlanFromHistory,
  computeSeasonalIndices,
  countNegativeSurplusMonths,
  deriveCompleteMonths,
  excludedPartialMonthBeforeStart,
  fillCompleteMonthAmounts,
  lastNFromCompleteMonths,
  projectSpendPlan,
  summarizeScenarios,
  TIM_SEASONAL_INDICES,
  type SpendPlanScenario,
} from "../lib/treasury/spend-plan";

const TIM_SCENARIOS: SpendPlanScenario[] = [
  { id: "A", name: "Flat", growthPct: 0, source: "assumed" },
  { id: "B", name: "+15%", growthPct: 0.15, source: "assumed" },
  { id: "C", name: "+30%", growthPct: 0.3, source: "assumed" },
  // Tim's published TTM; supplied explicitly — AL Finance transactions aren't in our DB
  { id: "D", name: "History repeats", growthPct: 0.594, source: "assumed" },
];

function near(a: number, b: number, tolPct = 0.005): boolean {
  if (b === 0) return Math.abs(a) < 1;
  return Math.abs(a - b) / Math.abs(b) <= tolPct;
}

/** Ending cumulative tolerates compounded monthly index rounding (~0.3%/mo over 24mo). */
function nearCumulativeEnding(a: number, b: number): boolean {
  const pctTol = Math.max(0.04, 0.005);
  return near(a, b, pctTol);
}

function ok(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "OK" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

let allOk = true;
function check(label: string, pass: boolean, detail = "") {
  if (!ok(label, pass, detail)) allOk = false;
}

console.log("\n=== Backtest fixture (exact) ===");
const BACKTEST_DEBITS: Record<string, number> = {
  "2025-08-01": 295664,
  "2025-09-01": 234781,
  "2025-10-01": 422181,
  "2025-11-01": 330503,
  "2025-12-01": 488015,
  "2026-01-01": 419052,
  "2026-02-01": 482246,
  "2026-03-01": 211753,
  "2026-04-01": 280626,
  "2026-05-01": 430764,
  "2026-06-01": 372870,
};

const EXPECTED_BACKTEST = [
  { t: 1, alloc: 375000, debits: 295664, surplus: 79336, cumul: 79336 },
  { t: 2, alloc: 375000, debits: 234781, surplus: 140219, cumul: 219555 },
  { t: 3, alloc: 375000, debits: 422181, surplus: -47181, cumul: 172374 },
  { t: 4, alloc: 410000, debits: 330503, surplus: 79497, cumul: 251871 },
  { t: 5, alloc: 410000, debits: 488015, surplus: -78015, cumul: 173855 },
  { t: 6, alloc: 410000, debits: 419052, surplus: -9052, cumul: 164803 },
  { t: 7, alloc: 445000, debits: 482246, surplus: -37246, cumul: 127557 },
  { t: 8, alloc: 445000, debits: 211753, surplus: 233247, cumul: 360805 },
  { t: 9, alloc: 445000, debits: 280626, surplus: 164374, cumul: 525178 },
  { t: 10, alloc: 480000, debits: 430764, surplus: 49236, cumul: 574415 },
  { t: 11, alloc: 480000, debits: 372870, surplus: 107130, cumul: 681545 },
];

const btRows = backtestSpendPlan({
  startMonth: "2025-08-01",
  startingBuffer: 0,
  base: 375000,
  step: 35000,
  stepEveryMonths: 3,
  actualDebits: BACKTEST_DEBITS,
  monthCount: 11,
});

for (const exp of EXPECTED_BACKTEST) {
  const row = btRows.find((r) => r.t === exp.t)!;
  check(`t=${exp.t} allocation`, row.allocation === exp.alloc, `got ${row.allocation}`);
  check(`t=${exp.t} debits`, row.actualDebits === exp.debits);
  check(`t=${exp.t} surplus`, row.surplus === exp.surplus, `got ${row.surplus}`);
  check(
    `t=${exp.t} cumulative`,
    row.cumulative === exp.cumul || Math.abs(row.cumulative - exp.cumul) <= 1,
    `got ${row.cumulative} (Tim sheet ±$1 display drift)`
  );
}

const negMonths = countNegativeSurplusMonths(btRows);
check("negative surplus months === 4", negMonths === 4, `got ${negMonths}`);
check(
  "cumulative never < 0",
  btRows.every((r) => r.cumulative >= 0),
  `min ${Math.min(...btRows.map((r) => r.cumulative))}`
);

console.log("\n=== Projection fixture (±0.5%) ===");
const L0 = 366218;
const BUFFER = 39105;

const proj = projectSpendPlan({
  startMonth: "2026-08-01",
  horizon: 24,
  startingBuffer: BUFFER,
  l0: L0,
  base: 375000,
  step: 35000,
  stepEveryMonths: 3,
  seasonalIndices: TIM_SEASONAL_INDICES,
  scenarios: TIM_SCENARIOS,
});

const t1 = proj[0]!;
const t2 = proj[1]!;
check("t=1 spend A", near(t1.spendByScenario.A, 419880), `got ${t1.spendByScenario.A}`);
check(
  "t=1 chain (Tim spend)",
  BUFFER + 375000 - 419880 === -5775
);
check(
  "t=1 cumul A (engine chain)",
  near(t1.cumulativeByScenario.A, BUFFER + 375000 - t1.spendByScenario.A, 0.001)
);
check("t=2 spend A", near(t2.spendByScenario.A, 252998), `got ${t2.spendByScenario.A}`);
check(
  "t=2 chain (Tim spend)",
  near(-5775 + 375000 - 252998, 116227, 0.001)
);

const t1Cumul = {
  A: -5775,
  B: -10694,
  C: -15056,
  D: -22399,
};
const t1SpendTim = {
  A: 419880,
  B: 424799,
  C: 429162,
  D: 436505,
};
for (const sc of ["A", "B", "C", "D"] as const) {
  check(
    `t=1 spend ${sc}`,
    near(t1.spendByScenario[sc], t1SpendTim[sc]),
    `got ${t1.spendByScenario[sc]}`
  );
  check(
    `t=1 cumul ${sc} (Tim chain)`,
    Math.abs(BUFFER + 375000 - t1SpendTim[sc] - t1Cumul[sc]) <= 1,
    `Tim ${t1Cumul[sc]}`
  );
}

const summaries = summarizeScenarios(proj, TIM_SCENARIOS);
for (const s of summaries) {
  check(
    `firstNegativeMonth ${s.scenarioId} === 1`,
    s.firstNegativeMonth === 1,
    `got ${s.firstNegativeMonth}`
  );
}

const t24 = proj[23]!;
const t24Expected = {
  A: { spend: 316608, cumul: 3189863 },
  B: { spend: 418714, cumul: 1779072 },
  C: { spend: 535067, cumul: 294385 },
  D: { spend: 803968, cumul: -2822538 },
};
for (const sc of ["A", "B", "C", "D"] as const) {
  check(
    `t=24 spend ${sc}`,
    near(t24.spendByScenario[sc], t24Expected[sc].spend, 0.006),
    `got ${t24.spendByScenario[sc]}`
  );
  check(
    `t=24 cumul ${sc}`,
    nearCumulativeEnding(t24.cumulativeByScenario[sc], t24Expected[sc].cumul),
    `got ${t24.cumulativeByScenario[sc]}`
  );
}

const endA = summaries.find((s) => s.scenarioId === "A")!.endingPosition;
const endD = summaries.find((s) => s.scenarioId === "D")!.endingPosition;
check("A ends strongly positive", endA > 1_000_000, `got ${endA}`);
check("D ends deeply negative", endD < -1_000_000, `got ${endD}`);

console.log("\n=== Allocation ladder ===");
const ladderTs = [1, 4, 7, 10, 13, 16, 19, 22];
const ladderVals = [375000, 410000, 445000, 480000, 515000, 550000, 585000, 620000];
for (let i = 0; i < ladderTs.length; i++) {
  const t = ladderTs[i]!;
  const expected = ladderVals[i]!;
  check(
    `allocation t=${t}`,
    allocationForMonth(t, 375000, 35000, 3) === expected
  );
}

console.log("\n=== Partial month / L0 window ===");
check(
  "excludedPartialMonth Jul-2026",
  excludedPartialMonthBeforeStart("2026-08-01", "2026-07-14") === "2026-07"
);

const brassMonkeyL0Months: Record<string, number> = {
  "2026-01-01": 419052,
  "2026-02-01": 482246,
  "2026-03-01": 211753,
  "2026-04-01": 280626,
  "2026-05-01": 430764,
  "2026-06-01": 372870,
};
const brassComplete = deriveCompleteMonths(brassMonkeyL0Months, "2026-07-14");
const l0Months = lastNFromCompleteMonths(brassComplete, 6);
check(
  "L0 window Jan–Jun 2026 (dataSpan)",
  l0Months.length === 6 &&
    l0Months[0] === "2026-01-01" &&
    l0Months[5] === "2026-06-01",
  l0Months.map((m) => m.slice(0, 7)).join(", ")
);

console.log("\n=== dataSpan — no phantom zeros outside history ===");
const ffmLike: Record<string, number> = {
  "2024-01-01": 5200,
  "2024-06-01": 5100,
  "2025-09-01": 5982,
  "2025-10-01": 4172,
  "2025-11-01": 6120,
  "2025-12-01": 5400,
  "2026-01-01": 6200,
  "2026-02-01": 5340,
};
const ffmComplete = deriveCompleteMonths(ffmLike, "2026-07-14");
const ffmFilled = fillCompleteMonthAmounts(ffmLike, ffmComplete);
const ffmL0Window = lastNFromCompleteMonths(ffmComplete, 6);
check(
  "L0 window ends at last data month (2026-02)",
  ffmL0Window.length > 0 && ffmL0Window[ffmL0Window.length - 1] === "2026-02-01",
  ffmL0Window.map((m) => m.slice(0, 7)).join(", ")
);
check(
  "L0 window does not include phantom Mar–Jun 2026",
  !ffmL0Window.some((m) => m >= "2026-03-01"),
  ffmL0Window.map((m) => m.slice(0, 7)).join(", ")
);
const ffmL0Vals = ffmL0Window.map((m) => ffmFilled[m] ?? -1);
check(
  "L0 not collapsed by phantom zeros",
  ffmL0Vals.every((v) => v > 1000),
  `min ${Math.min(...ffmL0Vals)}`
);

console.log("\n=== History repeats unavailable (<24 months) ===");
const thinHistory: Record<string, number> = {};
for (let i = 0; i < 18; i++) {
  const y = 2024 + Math.floor((i + 6) / 12);
  const mo = ((i + 6) % 12) + 1;
  thinHistory[`${y}-${String(mo).padStart(2, "0")}-01`] = 10000;
}
const thinBuilt = buildSpendPlanFromHistory({
  planStartMonth: "2026-08-01",
  asOf: "2026-07-14",
  horizon: 12,
  startingBuffer: 0,
  base: 10000,
  step: 0,
  monthlyDebits: thinHistory,
});
const defaultScenarios = buildDefaultScenarios(null);
check(
  "default scenarios omit history-repeats when TTM null",
  !defaultScenarios.some((s) => s.id === "history-repeats")
);
check(
  "historyRepeatsUnavailable flag set",
  thinBuilt.historyRepeatsUnavailable === true
);
check(
  "no History repeats in thin built plan",
  !thinBuilt.scenarios.some((s) => s.id === "history-repeats")
);

console.log("\n=== Seasonality guard ===");
const sparse = computeSeasonalIndices(
  { "2026-01-01": 100 },
  ["2026-01-01", "2026-02-01"],
  "2026-03-31"
);
check("seasonality disabled <12 months", sparse.seasonalityDisabled === true);
check("all indices 1.0 when disabled", Object.values(sparse.indices).every((v) => v === 1));

console.log("\n=== Synthetic seasonal index mean ≈ 1 ===");
const synthetic: Record<string, number> = {};
for (let i = 0; i < 24; i++) {
  const m = `2024-${String((i % 12) + 1).padStart(2, "0")}-01`;
  synthetic[m] = 100000 + (i % 12) * 5000;
}
const synKeys = Object.keys(synthetic).sort();
const synSeasonal = computeSeasonalIndices(synthetic, synKeys, "2026-01-31");
const meanIdx =
  Object.values(synSeasonal.indices).reduce((s, v) => s + v, 0) / 12;
check("synthetic mean index ≈ 1", near(meanIdx, 1, 0.02), `mean ${meanIdx}`);

console.log("\n=== 0.594 grep (lib/app/components only) ===");
const ROOT = join(import.meta.dirname ?? ".", "..");
const FORBIDDEN = "0.594";
const SCAN_DIRS = ["lib", "app", "components"];
const hits: string[] = [];

function walkDir(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      walkDir(full);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      if (readFileSync(full, "utf8").includes(FORBIDDEN)) hits.push(full);
    }
  }
}

for (const d of SCAN_DIRS) walkDir(join(ROOT, d));
check("no 0.594 in lib/app/components", hits.length === 0, hits.join(", "));

console.log(allOk ? "\nAll checks passed." : "\nSome checks FAILED.");
process.exit(allOk ? 0 : 1);
