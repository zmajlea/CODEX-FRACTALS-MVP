/**
 * Spec 65 gate — Cash Model on ana_gate_client_4. Reset after.
 * Usage: npx tsx scripts/gate-spec65-cash-model.ts
 *
 * Checks (spec order):
 * 1 Registry  2 Cascade/breach oracle  3 Scenario sensitivity  4 Coverage/degrade
 * 5 Loader reconcile  6 Splits  7 Backward history  8 Warning chip
 * 9 Interventions  10 Forecast retired  11 Charts  12 Build (assert artifacts)
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import {
  computeCashModel,
} from "../lib/treasury/cash-model";
import { backtestCashModel } from "../lib/treasury/cash-model-backtest";
import {
  computeCashModelInterventions,
  scenariosWithIntervention,
  toComputeInput,
} from "../lib/treasury/cash-model-interventions";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  type CashModelBucketKey,
  type CashModelParams,
  type CashModelScenario,
} from "../lib/treasury/cash-model-types";
import { buildRunwayStatus } from "../lib/treasury/cash-model-status";
import type { MonthlyByCategorySeries } from "../lib/treasury/load-monthly-by-category";
import { loadMonthlyByCategory } from "../lib/treasury/load-monthly-by-category";
import { directMonthlyByCategory } from "../lib/treasury/reconcile-monthly-by-category";
import { addMonths } from "../lib/treasury/period-bounds";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL = "ana_gate_client_4@codexone.test";
const ACCOUNT_ID = "cash-model-gate";
const OPENING = 80_000;
const THRESHOLD = 50_000;
/** Constant monthly burn shape — Tim-like SaaS. */
const COLL = 100_000;
const PAY = 60_000;
const OPEX = 50_000;
/** NCF = −10_000 → breach in month 4 from opening 80k vs floor 50k. */
const EXPECTED_NCF = COLL - PAY - OPEX; // -10000
const AS_OF = "2026-07-15"; // June last complete month

const results: Array<{ id: number; name: string; ok: boolean; detail: string }> = [];

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* */
  }
}

function log(msg: string) {
  console.log(`[gate65] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  results.push({ id, name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function monthKey(ym: string): string {
  return `${ym}-01`;
}

/** Independent cascade — no computeCashModel. */
function independentOracle(
  opening: number,
  ncfPerMonth: number,
  threshold: number,
  horizon: number,
  firstProjected: string
): {
  breachMonth: string | null;
  runwayMonths: number | null;
  minEnding: { month: string; value: number };
  endings: number[];
} {
  let ending = opening;
  let breachMonth: string | null = null;
  let runwayMonths: number | null = null;
  let minEnding = { month: firstProjected, value: Infinity };
  const endings: number[] = [];
  let cursor = firstProjected;
  for (let t = 1; t <= horizon; t++) {
    ending += ncfPerMonth;
    endings.push(ending);
    if (ending < minEnding.value) minEnding = { month: cursor, value: ending };
    if (!breachMonth && ending < threshold) {
      breachMonth = cursor;
      runwayMonths = t;
    }
    cursor = addMonths(cursor, 1);
  }
  if (minEnding.value === Infinity) minEnding = { month: firstProjected, value: opening };
  return { breachMonth, runwayMonths, minEnding, endings };
}

function buildFlatSeries(
  months: string[],
  labeled: boolean
): MonthlyByCategorySeries {
  const out: MonthlyByCategorySeries = {};
  for (const m of months) {
    if (labeled) {
      out["Collections"] = out["Collections"] ?? {};
      out["Collections"]![m] = { in: COLL, out: 0 };
      out["Payroll"] = out["Payroll"] ?? {};
      out["Payroll"]![m] = { in: 0, out: PAY };
      out["Opex operating"] = out["Opex operating"] ?? {};
      out["Opex operating"]![m] = { in: 0, out: OPEX };
    } else {
      out["__uncategorized__"] = out["__uncategorized__"] ?? {};
      out["__uncategorized__"]![m] = {
        in: COLL,
        out: PAY + OPEX,
      };
    }
  }
  return out;
}

function scenariosAt(threshold: number): CashModelScenario[] {
  return defaultCashModelScenarios().map((s) => ({
    ...s,
    minCashThreshold: threshold,
  }));
}

async function wipe(admin: AdminClient, clientId: string) {
  const { error: stErr } = await admin
    .from("treasury_studies")
    .delete()
    .eq("client_user_id", clientId);
  if (stErr) throw new Error(`wipe studies: ${stErr.message}`);

  const { data: rules } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientId);
  const ruleIds = (rules ?? []).map((r) => r.id);
  if (ruleIds.length > 0) {
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .in("rule_id", ruleIds);
    const { error: rErr } = await admin.from("treasury_rules").delete().in("id", ruleIds);
    if (rErr) throw new Error(`wipe rules: ${rErr.message}`);
  }
  // splits cascade from transactions
  const { error: txErr } = await admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", clientId);
  if (txErr) throw new Error(`wipe txs: ${txErr.message}`);
  const { error: aErr } = await admin
    .from("treasury_accounts")
    .delete()
    .eq("client_user_id", clientId);
  if (aErr) throw new Error(`wipe accounts: ${aErr.message}`);
}

async function seedBurnBook(admin: AdminClient, clientId: string) {
  const { error: acctErr } = await admin.from("treasury_accounts").upsert(
    {
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      name: "Cash model gate",
      type: "depository",
      source: "csv",
      current_balance: OPENING,
      available_balance: OPENING,
      iso_currency_code: "USD",
    },
    { onConflict: "client_user_id,account_id" }
  );
  if (acctErr) throw new Error(`account upsert: ${acctErr.message}`);

  // Six complete months Jan–Jun 2026; asOf mid-July → all complete.
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const rows: Array<Record<string, unknown>> = [];
  let i = 0;
  for (const ym of months) {
    const d = `${ym}-15`;
    rows.push({
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      source: "csv",
      external_id: `gate-coll-${ym}`,
      posted_date: d,
      amount: COLL,
      direction: "in",
      iso_currency_code: "USD",
      raw_name: "COLLECTIONS",
      merchant_name: "Collections",
      normalized_merchant: "COLLECTIONS",
      label: "Collections",
      label_source: "manual",
      pending: false,
      is_removed: false,
    });
    rows.push({
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      source: "csv",
      external_id: `gate-pay-${ym}`,
      posted_date: d,
      amount: PAY,
      direction: "out",
      iso_currency_code: "USD",
      raw_name: "PAYROLL",
      merchant_name: "Payroll",
      normalized_merchant: "PAYROLL",
      label: "Payroll",
      label_source: "manual",
      pending: false,
      is_removed: false,
    });
    rows.push({
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      source: "csv",
      external_id: `gate-opex-${ym}`,
      posted_date: d,
      amount: OPEX,
      direction: "out",
      iso_currency_code: "USD",
      raw_name: "OPEX OPERATING",
      merchant_name: "Opex operating",
      normalized_merchant: "OPEX OPERATING",
      label: "Opex operating",
      label_source: "manual",
      pending: false,
      is_removed: false,
    });
    void i++;
  }

  // One unlabeled outflow for coverage (small)
  rows.push({
    client_user_id: clientId,
    account_id: ACCOUNT_ID,
    source: "csv",
    external_id: "gate-uncat-2026-06",
    posted_date: "2026-06-20",
    amount: 1_000,
    direction: "out",
    iso_currency_code: "USD",
    raw_name: "MISC",
    merchant_name: "Misc",
    normalized_merchant: "MISC",
    label: null,
    pending: false,
    is_removed: false,
  });

  const { error: txErr } = await admin.from("treasury_transactions").insert(rows);
  if (txErr) throw new Error(`tx seed: ${txErr.message}`);
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "Missing Supabase env");

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  }) as AdminClient;

  const { data: clientRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  assert(clientRow, `${CLIENT_EMAIL} not found`);
  const clientId = clientRow.id;
  log(`client ${CLIENT_EMAIL} (${clientId})`);

  // ——— Pure-model checks (no DB) ———
  const histMonths = [
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
    "2026-06-01",
  ];
  const series = buildFlatSeries(histMonths, true);
  const params: CashModelParams = {
    ...defaultCashModelParams(),
    horizon: 13,
    selectedScenarioId: "base",
  };
  const scenarios = scenariosAt(THRESHOLD);
  const result = computeCashModel({
    categorySeries: series,
    bucketMap: {},
    openingBalance: OPENING,
    asOf: AS_OF,
    params,
    scenarios,
    excludedMonthSet: new Set(),
  });
  assert(!result.refused, `refused: ${result.refuseReason}`);

  const firstProj = result.timeline.find((r) => r.kind === "projected")?.month;
  assert(firstProj, "no projected months");
  const oracle = independentOracle(
    OPENING,
    EXPECTED_NCF,
    THRESHOLD,
    params.horizon,
    firstProj!
  );
  const baseSum = result.summaries.find((s) => s.scenarioId === "base");
  assert(baseSum, "no base summary");

  const breachOk =
    baseSum!.breachMonth?.slice(0, 7) === oracle.breachMonth?.slice(0, 7);
  const lowOk =
    Math.abs(baseSum!.minEnding.value - oracle.minEnding.value) < 0.01 &&
    baseSum!.minEnding.month.slice(0, 7) === oracle.minEnding.month.slice(0, 7);
  record(
    2,
    "Cascade + breach oracle",
    breachOk && lowOk,
    `breach model=${baseSum!.breachMonth} oracle=${oracle.breachMonth}; low model=${baseSum!.minEnding.value}@${baseSum!.minEnding.month} oracle=${oracle.minEnding.value}@${oracle.minEnding.month}; runway=${baseSum!.runwayMonths}`
  );

  // 3 Scenario sensitivity
  const downsideParams = { ...params, selectedScenarioId: "downside" };
  const down = computeCashModel({
    categorySeries: series,
    bucketMap: {},
    openingBalance: OPENING,
    asOf: AS_OF,
    params: downsideParams,
    scenarios,
    excludedMonthSet: new Set(),
  });
  const downSum = down.summaries.find((s) => s.scenarioId === "downside");
  assert(downSum, "no downside summary");
  const moved =
    downSum!.breachMonth !== baseSum!.breachMonth ||
    (downSum!.runwayMonths ?? 0) !== (baseSum!.runwayMonths ?? 0);
  // Downside: collections 0.9, payroll 1.05, opex 1.08 → worse NCF → earlier breach
  const worse =
    (downSum!.runwayMonths ?? 999) < (baseSum!.runwayMonths ?? 999) ||
    (downSum!.breachMonth != null &&
      baseSum!.breachMonth != null &&
      downSum!.breachMonth < baseSum!.breachMonth);
  record(
    3,
    "Scenario moves the answer",
    moved && worse,
    `base breach=${baseSum!.breachMonth} runway=${baseSum!.runwayMonths}; downside breach=${downSum!.breachMonth} runway=${downSum!.runwayMonths}`
  );

  // 4 Coverage / degrade
  const uncatSeries = buildFlatSeries(histMonths, false);
  const degraded = computeCashModel({
    categorySeries: uncatSeries,
    bucketMap: {},
    openingBalance: OPENING,
    asOf: AS_OF,
    params,
    scenarios,
    excludedMonthSet: new Set(),
  });
  assert(!degraded.refused, "uncat refused");
  const hasUncat =
    (degraded.bucketBaselines.uncategorized_in ?? 0) > 0 ||
    (degraded.bucketBaselines.uncategorized_out ?? 0) > 0 ||
    degraded.degradedToTotals;
  record(
    4,
    "Coverage / degrade",
    degraded.degradedToTotals && hasUncat && degraded.coveragePct < 0.35,
    `coverage=${(degraded.coveragePct * 100).toFixed(1)}% degraded=${degraded.degradedToTotals} uncat_in=${degraded.bucketBaselines.uncategorized_in} uncat_out=${degraded.bucketBaselines.uncategorized_out}`
  );

  // 7 Backward history — projection seam starts at current_balance (opening)
  const firstProjectedEnding = result.timeline.find((r) => r.kind === "projected");
  const lastActual = [...result.timeline].reverse().find((r) => r.kind === "actual");
  // Backward walk: June ending = opening − ncf(June) when asOf month is July (not in history)
  // i.e. ending[June] = 80k − (−10k) = 90k
  const expectedLastActual = OPENING - EXPECTED_NCF;
  const historyOk =
    firstProjectedEnding != null &&
    Math.abs(firstProjectedEnding.ending - (OPENING + EXPECTED_NCF)) < 0.01 &&
    lastActual != null &&
    Math.abs(lastActual.ending - expectedLastActual) < 0.01 &&
    result.timeline.every((r) => (r.kind === "actual" ? r.historyDerived === true : true));
  record(
    7,
    "Backward history anchor",
    historyOk,
    `opening=${OPENING}; lastActual=${lastActual?.ending}@${lastActual?.month} (expect ${expectedLastActual}); firstProj=${firstProjectedEnding?.ending}@${firstProjectedEnding?.month} (expect ${OPENING + EXPECTED_NCF}); historyDerived on actuals`
  );

  // 8 Warning chip
  const greenStatus = buildRunwayStatus(
    computeCashModel({
      categorySeries: series,
      bucketMap: {},
      openingBalance: 5_000_000,
      asOf: AS_OF,
      params,
      scenarios: scenariosAt(1_000),
      excludedMonthSet: new Set(),
    }).summaries,
    params
  );
  const redStatus = buildRunwayStatus(result.summaries, params);
  // amber: base clears, downside breaches (opening 500k, floor 200k)
  const amber2 = computeCashModel({
    categorySeries: series,
    bucketMap: {},
    openingBalance: 500_000,
    asOf: AS_OF,
    params,
    scenarios: scenariosAt(200_000),
    excludedMonthSet: new Set(),
  });
  const amberChip2 = buildRunwayStatus(amber2.summaries, params);
  const chipOk =
    greenStatus.level === "green" &&
    redStatus.level === "red" &&
    amberChip2.level === "amber";
  record(
    8,
    "Warning chip",
    chipOk,
    `green=${greenStatus.level} red=${redStatus.level} amber=${amberChip2.level} (${amberChip2.label})`
  );

  // 9 Interventions
  const interventions = computeCashModelInterventions(
    toComputeInput(
      { categorySeries: series, openingBalance: OPENING, asOf: AS_OF },
      params,
      scenarios
    ),
    "base"
  );
  const clearing = interventions.find((i) => i.clearsBreach);
  assert(clearing, "no clearing intervention");
  const applied = computeCashModel({
    categorySeries: series,
    bucketMap: {},
    openingBalance: OPENING,
    asOf: AS_OF,
    params,
    scenarios: scenariosWithIntervention(
      scenarios,
      "base",
      clearing!.bucket,
      clearing!.factorMultiplier
    ),
    excludedMonthSet: new Set(),
  });
  const appliedSum = applied.summaries.find((s) => s.scenarioId === "base");
  record(
    9,
    "Interventions",
    Boolean(appliedSum?.noBreachInHorizon),
    `proposal=${clearing!.label}; applied noBreach=${appliedSum?.noBreachInHorizon}; count=${interventions.length}`
  );

  // 11 Charts (static)
  const runwaySrc = readFileSync(
    join(ROOT, "components/operator/treasury/cash-model/CashModelRunwayChart.tsx"),
    "utf8"
  );
  const explainSrc = readFileSync(
    join(ROOT, "components/operator/treasury/cash-model/CashModelExplainChart.tsx"),
    "utf8"
  );
  const pathCount = (runwaySrc.match(/<path\b/g) ?? []).length;
  const lineCount = (runwaySrc.match(/<line\b/g) ?? []).length;
  // Spec: runway ≤5 lines — ending (actual+projected share stroke), threshold, optional downside, breach vertical. Soft check: path count ≤4, uses bars in explain.
  const chartsOk =
    pathCount <= 4 &&
    explainSrc.includes("<rect") &&
    runwaySrc.includes("strokeDasharray");
  record(
    11,
    "Charts",
    chartsOk,
    `runway paths=${pathCount} lines=${lineCount}; explain rects=${(explainSrc.match(/<rect/g) ?? []).length}`
  );

  // ——— DB-backed ———
  log("wipe + seed burn book");
  await wipe(admin, clientId);
  await seedBurnBook(admin, clientId);

  // 1 Registry
  let studyId: string | null = null;
  {
    const { data: existing } = await admin
      .from("treasury_studies")
      .select("*")
      .eq("client_user_id", clientId)
      .eq("type", "cash_model")
      .eq("is_primary", true)
      .maybeSingle();
    if (existing) {
      studyId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("treasury_studies")
        .insert({
          client_user_id: clientId,
          name: "Primary cash model",
          type: "cash_model",
          scope: { accountId: ACCOUNT_ID },
          params: params as unknown as Database["public"]["Tables"]["treasury_studies"]["Insert"]["params"],
          scenarios: scenarios as unknown as Database["public"]["Tables"]["treasury_studies"]["Insert"]["scenarios"],
          derived_snapshot: {
            bucketBaselines: result.bucketBaselines,
            coveragePct: result.coveragePct,
            bucketMap: {},
            openingBalance: OPENING,
            asOf: AS_OF,
            historyMonthCount: result.completeMonths.length,
            historyDerived: true,
            runwayStatus: redStatus,
          } as unknown as Database["public"]["Tables"]["treasury_studies"]["Insert"]["derived_snapshot"],
          is_primary: true,
        })
        .select("id")
        .single();
      assert(!insErr && inserted, insErr?.message ?? "study insert");
      studyId = inserted!.id;
    }
    const { error: dupErr } = await admin.from("treasury_studies").insert({
      client_user_id: clientId,
      name: "Dup primary",
      type: "cash_model",
      scope: { accountId: ACCOUNT_ID },
      params: params as never,
      scenarios: scenarios as never,
      derived_snapshot: {
        asOf: AS_OF,
        historyMonthCount: 0,
        historyDerived: true,
        bucketBaselines: {},
        coveragePct: 0,
        bucketMap: {},
        openingBalance: null,
      } as never,
      is_primary: true,
    });
    const dupBlocked = Boolean(dupErr);
    const { count } = await admin
      .from("treasury_studies")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("type", "cash_model")
      .eq("is_primary", true);
    const { data: sp, error: spErr } = await admin
      .from("treasury_studies")
      .insert({
        client_user_id: clientId,
        name: "Gate spend plan",
        type: "spend_plan",
        scope: { accountId: ACCOUNT_ID },
        params: {
          base: 1000,
          step: 0,
          stepEveryMonths: 3,
          horizon: 12,
          startMonth: "2026-08",
          backtest: { startMonth: "2026-01-01", months: 6 },
          bufferAdjustment: 0,
          overrides: {},
          excludedMonths: [],
        } as never,
        scenarios: [] as never,
        derived_snapshot: {
          l0: 1000,
          l0Window: [],
          seasonal: {},
          ttmYoy: null,
          buffer: null,
          asOf: AS_OF,
          excludedPartialMonth: null,
          historyMonthCount: 6,
        } as never,
        is_primary: false,
      })
      .select("id")
      .single();
    record(
      1,
      "Registry",
      Boolean(studyId) && dupBlocked && (count ?? 0) === 1 && !spErr && Boolean(sp),
      `cash_model primary=${studyId}; dupBlocked=${dupBlocked}; primaryCount=${count}; spend_plan=${sp?.id}`
    );
  }

  // 5 Loaders reconcile
  const rpcSeries = await loadMonthlyByCategory(admin, clientId, {
    accountId: ACCOUNT_ID,
    from: "2026-01-01",
    to: "2026-06-30",
  });
  const direct = await directMonthlyByCategory(admin, clientId, {
    accountId: ACCOUNT_ID,
    from: "2026-01-01",
    to: "2026-06-30",
  });
  const flatFromRpc: Array<{ label: string; direction: string; month: string; total: number }> =
    [];
  for (const [label, months] of Object.entries(rpcSeries)) {
    for (const [month, cell] of Object.entries(months)) {
      if (cell.in) flatFromRpc.push({ label, direction: "in", month: month.slice(0, 10), total: cell.in });
      if (cell.out) flatFromRpc.push({ label, direction: "out", month: month.slice(0, 10), total: cell.out });
    }
  }
  const rowKey = (r: { label: string; direction: string; month: string }) =>
    `${r.label}|${r.direction}|${r.month.slice(0, 7)}`;
  const directMap = new Map(direct.map((r) => [rowKey(r), r.total]));
  let loaderOk = true;
  let loaderDetail = "";
  for (const r of flatFromRpc) {
    const d = directMap.get(rowKey(r));
    if (d == null || Math.abs(d - r.total) > 0.02) {
      loaderOk = false;
      loaderDetail = `mismatch ${rowKey(r)} rpc=${r.total} direct=${d}`;
      break;
    }
  }
  if (loaderOk) {
    loaderDetail = `rpc cells=${flatFromRpc.length} direct=${direct.length}`;
  }
  record(5, "Loaders reconcile", loaderOk, loaderDetail);

  // 6 Splits
  const { data: payTx } = await admin
    .from("treasury_transactions")
    .select("id, amount, label")
    .eq("client_user_id", clientId)
    .eq("external_id", "gate-pay-2026-06")
    .maybeSingle();
  assert(payTx, "payroll tx missing");
  const half = Number(payTx!.amount) / 2;
  const { error: splitRpcErr } = await admin.rpc("treasury_replace_transaction_splits", {
    p_transaction_id: payTx!.id,
    p_slices: [
      { label: "Payroll", amount: half },
      { label: "Debt Service", amount: half },
    ],
  });
  assert(!splitRpcErr, splitRpcErr?.message ?? "split replace");

  // Bad sum must fail
  let sumInvariant = false;
  {
    const { error: bad } = await admin.rpc("treasury_replace_transaction_splits", {
      p_transaction_id: payTx!.id,
      p_slices: [
        { label: "Payroll", amount: 10 },
        { label: "Debt Service", amount: 10 },
      ],
    });
    sumInvariant = Boolean(bad);
  }
  // Restore valid splits
  await admin.rpc("treasury_replace_transaction_splits", {
    p_transaction_id: payTx!.id,
    p_slices: [
      { label: "Payroll", amount: half },
      { label: "Debt Service", amount: half },
    ],
  });

  const afterSplit = await loadMonthlyByCategory(admin, clientId, {
    accountId: ACCOUNT_ID,
    from: "2026-01-01",
    to: "2026-06-30",
  });
  let payrollJune = 0;
  let debtJune = 0;
  let payrollOther = 0;
  for (const [lab, months] of Object.entries(afterSplit)) {
    for (const [m, cell] of Object.entries(months)) {
      if (lab === "Payroll") {
        if (m.startsWith("2026-06")) payrollJune += cell.out;
        else payrollOther += cell.out;
      }
      if (lab === "Debt Service" && m.startsWith("2026-06")) debtJune += cell.out;
    }
  }
  // Unsplit months still have full PAY; June split: half Payroll + half Debt — never full PAY+slices
  const noDouble =
    Math.abs(payrollJune - half) < 0.02 &&
    Math.abs(debtJune - half) < 0.02 &&
    Math.abs(payrollOther - PAY * 5) < 0.02;
  const directAfter = await directMonthlyByCategory(admin, clientId, {
    accountId: ACCOUNT_ID,
    from: "2026-01-01",
    to: "2026-06-30",
  });
  const directPayrollJune = directAfter.find(
    (r) => r.label === "Payroll" && r.direction === "out" && r.month.startsWith("2026-06")
  );
  record(
    6,
    "Splits",
    sumInvariant && noDouble && Math.abs((directPayrollJune?.total ?? 0) - half) < 0.02,
    `sumInvariant=${sumInvariant}; junePayroll=${payrollJune} juneDebt=${debtJune} otherPayroll=${payrollOther}; expect june=${half}/${half} other=${PAY * 5}; directJunePayroll=${directPayrollJune?.total}`
  );

  // 10 Forecast retired
  const analyticsSrc = readFileSync(
    join(ROOT, "components/operator/treasury/TreasuryAnalyticsPanel.tsx"),
    "utf8"
  );
  const recordSrc = readFileSync(
    join(ROOT, "components/operator/OperatorTreasuryClientRecord.tsx"),
    "utf8"
  );
  const committedSrc = readFileSync(
    join(ROOT, "lib/treasury/committed-flows.ts"),
    "utf8"
  );
  const clientTrendSrc = readFileSync(
    join(ROOT, "components/treasury/TreasuryClientCashTrend.tsx"),
    "utf8"
  );
  const forecastRouteGone = !existsSync(
    join(ROOT, "app/api/operator/treasury/clients/[clientId]/forecast/route.ts")
  );
  const forecastRetired =
    !analyticsSrc.includes('id="t-forecast"') &&
    !analyticsSrc.includes(">Forecast<") &&
    analyticsSrc.includes("Cash model") &&
    analyticsSrc.includes("Studies") &&
    recordSrc.includes('viewParam === "forecast"') &&
    recordSrc.includes('return "cash_model"') &&
    forecastRouteGone &&
    committedSrc.includes("detectCadence") &&
    committedSrc.includes('from "@/lib/treasury/rule-helpers"') &&
    clientTrendSrc.includes("/api/treasury/summary") &&
    !clientTrendSrc.includes("/forecast");
  record(
    10,
    "Forecast retired",
    forecastRetired,
    `routeGone=${forecastRouteGone}; detectCadence salvage=${committedSrc.includes("detectCadence")}; client summary intact=${clientTrendSrc.includes("/api/treasury/summary")}`
  );

  // Backtest smoke (not numbered, supports credibility)
  const bt = backtestCashModel(
    series,
    {},
    OPENING,
    AS_OF,
    params,
    scenarios,
    { fullTimeline: result.timeline }
  );
  log(`backtest rows=${bt.length} (informational)`);

  // 12 Build
  log("npm run build");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(12, "npm run build", true, "exit 0");

  log("wipe client 4");
  await wipe(admin, clientId);

  console.log("\n=== Spec 65 gate summary ===");
  for (const r of results.sort((a, b) => a.id - b.id)) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}: ${r.detail}`);
  }
  log("ALL PASS — STOP no merge");
}

main().catch(async (e) => {
  console.error(e);
  try {
    loadEnvLocal();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const admin = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: { transport: ws as never },
      }) as AdminClient;
      const { data: clientRow } = await admin
        .from("users")
        .select("id")
        .ilike("email", CLIENT_EMAIL)
        .maybeSingle();
      if (clientRow) {
        await wipe(admin, clientRow.id);
        console.log("[gate65] wiped client 4 after failure");
      }
    }
  } catch (wipeErr) {
    console.error("[gate65] wipe-after-fail also failed", wipeErr);
  }
  process.exit(1);
});
