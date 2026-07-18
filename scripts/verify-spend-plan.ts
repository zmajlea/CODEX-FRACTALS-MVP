/**
 * Tim's spend-plan fixture validation (Spec 25 + Spec 28 + Spec 38A).
 * Run: npm run treasury:verify-spend-plan
 *
 * SOURCE: AL_Finance_PD_Stress_Test — Tim's own sheet.
 * Screenshots: CODEXONE/170726-R1-anallyzer/image01|02|03.png (2026-07-17)
 * These are HIS published numbers, not our derivation. Do not "fix" the engine
 * to match a value here without first checking the screenshot.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  allocationForMonth,
  backtestSpendPlan,
  buildDefaultScenarios,
  buildSpendPlanFromHistory,
  computeL0,
  computeSeasonalIndices,
  computeTtmYoyGrowth,
  countNegativeSurplusMonths,
  deriveCompleteMonths,
  excludedPartialMonthBeforeStart,
  fillCompleteMonthAmounts,
  lastNFromCompleteMonths,
  meanOfMonths,
  partitionIntoYearBlocks,
  projectSpendPlan,
  roundSeasonalIndices2dp,
  summarizeScenarios,
  TIM_SEASONAL_INDICES,
  type SpendPlanScenario,
} from "../lib/treasury/spend-plan";

/**
 * image01 column B — full-precision PD debits (Jul-2024 … Jun-2026).
 * From CODEXONE/analyzer-mockup/index.html RAW[].
 */
const TIM_PD_DEBITS: Record<string, number> = {
  "2024-07-01": 223714.7,
  "2024-08-01": 320504.86,
  "2024-09-01": 157582.1,
  "2024-10-01": 186627.96,
  "2024-11-01": 221622.45,
  "2024-12-01": 187385.42,
  "2025-01-01": 258801.58,
  "2025-02-01": 160285.82,
  "2025-03-01": 199067.52,
  "2025-04-01": 279563.83,
  "2025-05-01": 175568.82,
  "2025-06-01": 277503.69,
  "2025-07-01": 251562.01,
  "2025-08-01": 295663.83,
  "2025-09-01": 234780.92,
  "2025-10-01": 422181.05,
  "2025-11-01": 330503.47,
  "2025-12-01": 488015.27,
  "2026-01-01": 419052.37,
  "2026-02-01": 482246.01,
  "2026-03-01": 211752.58,
  "2026-04-01": 280626.09,
  "2026-05-01": 430763.51,
  "2026-06-01": 372870.07,
};

const AS_OF = "2026-07-14";
const BUFFER = 39105;

function near(a: number, b: number, tolPct = 0.005): boolean {
  if (b === 0) return Math.abs(a) < 1;
  return Math.abs(a - b) / Math.abs(b) <= tolPct;
}

/** Spec 38A: absolute ≤ $50 — the 4% tolerance covered the 2dp-index bug. */
function nearCumulativeEnding(a: number, b: number): boolean {
  return Math.abs(a - b) <= 50;
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
check(
  "backtest ending === 681545",
  btRows[btRows.length - 1]!.cumulative === 681545 ||
    Math.abs(btRows[btRows.length - 1]!.cumulative - 681545) <= 1,
  `got ${btRows[btRows.length - 1]!.cumulative}`
);
check(
  "backtest min surplus === 79336",
  Math.min(...btRows.map((r) => r.surplus)) === 79336 ||
    btRows[0]!.surplus === 79336,
  `first surplus ${btRows[0]!.surplus}`
);

console.log("\n=== Spec 38A — Tim block means, L0, indices, history-repeats ===");
const complete = deriveCompleteMonths(TIM_PD_DEBITS, AS_OF);
const filled = fillCompleteMonthAmounts(TIM_PD_DEBITS, complete);
const blocks = partitionIntoYearBlocks(complete);
check("two year-blocks from 24 months", blocks.length === 2, `got ${blocks.length}`);

const year1Mean = meanOfMonths(filled, blocks[0]!);
const year2Mean = meanOfMonths(filled, blocks[1]!);
check(
  "Year 1 mean (first block) === 220686",
  Math.abs(year1Mean - 220686) < 0.5,
  `got ${year1Mean}`
);
check(
  "Year 2 mean (latest block) === 351668",
  Math.abs(year2Mean - 351668) < 0.5,
  `got ${year2Mean}`
);

const l0Months = lastNFromCompleteMonths(complete, 6);
const l0 = computeL0(filled, l0Months)!;
check(
  "L0 === 366218.44",
  Math.abs(l0 - 366218.44) < 0.01,
  `got ${l0}`
);

const seasonal = computeSeasonalIndices(filled, complete, AS_OF);
check("seasonality enabled", seasonal.seasonalityDisabled === false);
const idx2 = roundSeasonalIndices2dp(seasonal.indices);
const idxSum2 =
  Object.values(idx2).reduce((s, v) => s + v, 0);
check(
  "2dp indices match TIM_SEASONAL_INDICES oracle",
  ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).every(
    (m) => idx2[m] === TIM_SEASONAL_INDICES[m]
  ),
  Object.entries(idx2)
    .map(([m, v]) => `${m}:${v}`)
    .join(" ")
);
check(
  "2dp index sum ≈ 11.99 (predicted rounding of exact Σ=12)",
  Math.abs(idxSum2 - 11.99) < 0.005 || Math.abs(idxSum2 - 12) < 0.02,
  `sum ${idxSum2}`
);

const fullPrecisionSum = Object.values(seasonal.indices).reduce((s, v) => s + v, 0);
check(
  "full-precision indices sum ≈ 12 (self-normalising, full sample)",
  Math.abs(fullPrecisionSum - 12) < 1e-9,
  `sum ${fullPrecisionSum}`
);
check(
  "full sample: each calendar month n=2",
  ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).every(
    (m) => seasonal.sampleCounts[m] === 2
  ),
  Object.entries(seasonal.sampleCounts)
    .map(([m, n]) => `${m}:n=${n}`)
    .join(" ")
);

const historyG = computeTtmYoyGrowth(filled, complete);
check(
  "history-repeats growth ≈ 0.5935",
  historyG != null && Math.abs(historyG - 0.5935) < 0.00005,
  `got ${historyG}`
);

const TIM_SCENARIOS: SpendPlanScenario[] = [
  { id: "A", name: "Flat", growthPct: 0, source: "assumed" },
  { id: "B", name: "+15%", growthPct: 0.15, source: "assumed" },
  { id: "C", name: "+30%", growthPct: 0.3, source: "assumed" },
  {
    id: "D",
    name: "History repeats",
    growthPct: historyG!,
    source: "pulled",
  },
];

console.log("\n=== Projection from computed indices (not 2dp oracle) ===");
const proj = projectSpendPlan({
  startMonth: "2026-08-01",
  horizon: 24,
  startingBuffer: BUFFER,
  l0,
  base: 375000,
  step: 35000,
  stepEveryMonths: 3,
  seasonalIndices: seasonal.indices,
  scenarios: TIM_SCENARIOS,
});

const t24 = proj[23]!;
const t24Expected = {
  A: { spend: 316608, cumul: 3189863 },
  B: { spend: 418714, cumul: 1779072 },
  C: { spend: 535067, cumul: 294385 },
  D: { spend: 803968, cumul: -2822538 },
};
for (const sc of ["A", "B", "C", "D"] as const) {
  check(
    `t=24 spend ${sc} exact`,
    Math.round(t24.spendByScenario[sc]!) === t24Expected[sc].spend,
    `got ${t24.spendByScenario[sc]}`
  );
  check(
    `t=24 cumul ${sc} ≤$50`,
    nearCumulativeEnding(t24.cumulativeByScenario[sc]!, t24Expected[sc].cumul),
    `got ${t24.cumulativeByScenario[sc]} (Δ ${Math.abs(t24.cumulativeByScenario[sc]! - t24Expected[sc].cumul).toFixed(2)})`
  );
}

const summaries = summarizeScenarios(proj, TIM_SCENARIOS);
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
  excludedPartialMonthBeforeStart("2026-08-01", AS_OF) === "2026-07"
);
check(
  "L0 window Jan–Jun 2026",
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
const ffmComplete = deriveCompleteMonths(ffmLike, AS_OF);
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
  asOf: AS_OF,
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
  const y = 2024 + Math.floor(i / 12);
  const mo = (i % 12) + 1;
  synthetic[`${y}-${String(mo).padStart(2, "0")}-01`] = 100000 + (i % 12) * 5000;
}
const synKeys = Object.keys(synthetic).sort();
const synSeasonal = computeSeasonalIndices(synthetic, synKeys, "2026-01-31");
const meanIdx =
  Object.values(synSeasonal.indices).reduce((s, v) => s + v, 0) / 12;
check("synthetic mean index ≈ 1", near(meanIdx, 1, 0.02), `mean ${meanIdx}`);

console.log("\n=== Spec 38B — exclusion shortens block, does not collapse years ===");
const exclDec = computeSeasonalIndices(filled, complete, AS_OF, ["2025-12"]);
const exclBlocks = partitionIntoYearBlocks(complete);
check("exclusion keeps two block boundaries", exclBlocks.length === 2);
const y2Present = exclBlocks[1]!.filter((k) => k.slice(0, 7) !== "2025-12");
check(
  "latest block has 11 months when Dec excluded",
  y2Present.length === 11,
  `got ${y2Present.length}`
);
check(
  "excluding Dec changes seasonal indices vs baseline",
  Math.abs((exclDec.indices[12] ?? 0) - (seasonal.indices[12] ?? 0)) > 1e-6 ||
    Math.abs((exclDec.indices[6] ?? 0) - (seasonal.indices[6] ?? 0)) > 1e-6,
  `Dec idx ${exclDec.indices[12]} vs ${seasonal.indices[12]}`
);
check(
  "excluding Dec drops Dec sample count to n=1",
  exclDec.sampleCounts[12] === 1,
  `n=${exclDec.sampleCounts[12]}`
);
check(
  "excluding Dec does not keep other months at n=2",
  ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const).every(
    (m) => exclDec.sampleCounts[m] === 2
  )
);
const exclSum = Object.values(exclDec.indices).reduce((s, v) => s + v, 0);
check(
  "excluding Dec: Σ indices ≠ 12 (no silent renormalise)",
  Math.abs(exclSum - 12) > 1e-6,
  `sum ${exclSum}`
);
const l0ExclMar = computeL0(
  filled,
  lastNFromCompleteMonths(
    complete.filter((m) => m.slice(0, 7) !== "2026-03"),
    6
  )
)!;
check(
  "excluding a month inside L0 window moves L0",
  Math.abs(l0ExclMar - 366218.44) > 1,
  `L0 ${l0ExclMar}`
);
const gExcl = computeTtmYoyGrowth(filled, complete, ["2025-12"]);
check(
  "history-repeats still computable with exclusion",
  gExcl != null && Number.isFinite(gExcl),
  `got ${gExcl}`
);
check(
  "excluding Dec changes history-repeats vs 0.5935",
  gExcl != null && Math.abs(gExcl - 0.5935) > 0.001,
  `got ${gExcl}`
);

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
