/**
 * Spec 65-S — Tim-shaped Cash Model demo seed on ana_gate_client_2.
 * Persistent (gates only wipe client_4). Prerequisite: npm run test:seed:ana-gate
 *
 * Usage: npx tsx scripts/seed-cash-model-demo.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { computeCashModel } from "../lib/treasury/cash-model";
import {
  computeCashModelInterventions,
  toComputeInput,
} from "../lib/treasury/cash-model-interventions";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  scaleAwareMinCashThreshold,
} from "../lib/treasury/cash-model-types";
import { buildRunwayStatus } from "../lib/treasury/cash-model-status";
import type { MonthlyByCategorySeries } from "../lib/treasury/load-monthly-by-category";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL = "ana_gate_client_2@codexone.test";
const ACCOUNT_ID = "cash-model-demo";
const AS_OF = "2026-07-15";
const OPENING_TARGET = 800_000;
const MONTHS = 24; // Jan 2024 → Dec 2025 history, then Jan–Jun 2026 → 30? 
// Use 24 complete months ending Jun 2026: Jul 2024 – Jun 2026

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
  console.log(`[seed65S] ${msg}`);
}

function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthListEnding(lastYm: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonthsYm(lastYm, -i));
  return out;
}

type MonthShape = {
  ym: string;
  collections: number;
  payroll: number;
  opex: number;
  debt: number;
  capex: number;
  uncatOut: number;
};

/**
 * Shape tuned so trailing-6 baselines yield:
 * Base breach ~mo 9–10, Downside ~mo 6, +10% collections clears, coverage ~85–90%.
 *
 * Trailing window targets (approx monthly):
 *   collections 200k, payroll 130k, opex 90k, debt~9k, uncat~35k → NCF ≈ −64k
 *   @ opening 800k / floor 400k → base runway ~6–7… too fast.
 * Softer burn (−42k): collections 210k, payroll 125k, opex 88k, debt 9k, uncat 30k.
 */
function buildShapes(lastCompleteYm: string): MonthShape[] {
  const months = monthListEnding(lastCompleteYm, MONTHS);
  const shapes: MonthShape[] = [];

  // Trailing targets → NCF ≈ −45k @ open 800k / floor 400k → runway ~9
  const target = {
    collections: 218_000,
    payroll: 124_000,
    opex: 87_000,
  };

  for (let i = 0; i < months.length; i++) {
    const ym = months[i]!;
    const mo = Number(ym.slice(5, 7));
    const fromEnd = months.length - 1 - i;

    const growth = Math.pow(1.02, -fromEnd);
    const seas = mo >= 10 ? 1.02 : mo <= 2 ? 0.99 : 1;
    const collections = Math.round(target.collections * growth * seas);

    let payroll = Math.round(target.payroll * Math.pow(1.012, -fromEnd));
    if (fromEnd > 16) payroll = Math.round(payroll / 1.1);
    if (fromEnd > 8 && fromEnd <= 16) payroll = Math.round(payroll / 1.06);

    const opex = Math.round(target.opex * Math.pow(1.003, -fromEnd));
    const debt = mo % 3 === 0 ? 26_000 : 0;
    const capex = fromEnd === 9 ? 80_000 : 0;

    const labeledOut = payroll + opex + debt + capex;
    const uncatOut = Math.round(labeledOut * 0.17);

    shapes.push({ ym, collections, payroll, opex, debt, capex, uncatOut });
  }
  return shapes;
}

function ncfOf(s: MonthShape): number {
  return s.collections - s.payroll - s.opex - s.debt - s.capex - s.uncatOut;
}

async function wipe(admin: AdminClient, clientId: string) {
  await admin.from("treasury_studies").delete().eq("client_user_id", clientId);
  const { data: rules } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientId);
  const ruleIds = (rules ?? []).map((r) => r.id);
  if (ruleIds.length > 0) {
    await admin.from("treasury_transaction_suggestions").delete().in("rule_id", ruleIds);
    await admin.from("treasury_rules").delete().in("id", ruleIds);
  }
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

function toSeries(shapes: MonthShape[]): MonthlyByCategorySeries {
  const series: MonthlyByCategorySeries = {};
  for (const s of shapes) {
    const mk = `${s.ym}-01`;
    (series["Customer collections"] ??= {})[mk] = { in: s.collections, out: 0 };
    (series["Payroll"] ??= {})[mk] = { in: 0, out: s.payroll };
    (series["Opex operating"] ??= {})[mk] = { in: 0, out: s.opex };
    if (s.debt > 0) {
      (series["Debt service"] ??= {})[mk] = { in: 0, out: s.debt };
    }
    if (s.capex > 0) {
      (series["Capex"] ??= {})[mk] = { in: 0, out: s.capex };
    }
    if (s.uncatOut > 0) {
      (series["__uncategorized__"] ??= {})[mk] = { in: 0, out: s.uncatOut };
    }
  }
  return series;
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  }) as AdminClient;

  const { data: clientRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  if (!clientRow) {
    throw new Error(
      `${CLIENT_EMAIL} not found — run npm run test:seed:ana-gate first`
    );
  }
  const clientId = clientRow.id;
  log(`client ${CLIENT_EMAIL} = ${clientId}`);

  log("wipe prior demo book on client_2");
  await wipe(admin, clientId);

  const shapes = buildShapes("2026-06");
  const series = toSeries(shapes);

  // Walk forward from a synthetic start so ending at asOf ≈ OPENING_TARGET
  // Backward: ending[last]=opening. Forward walk from first month to verify.
  let cursor = OPENING_TARGET;
  // Reconstruct start-of-first-month by reverse-walking with correct formula
  for (let i = shapes.length - 1; i >= 0; i--) {
    // ending[i] known for last; going back: ending[i-1] = ending[i] - ncf[i]
    // At i=last, ending = OPENING. For i-1: ending[i-1] = OPENING - ncf[last] ...
    if (i === shapes.length - 1) continue;
    const nextNcf = ncfOf(shapes[i + 1]!);
    cursor = cursor - nextNcf;
  }
  // cursor is now ending of first month... actually after loop starting from OPENING:
  // We want beginning balance for seeding display. Set account current_balance = OPENING_TARGET.

  const avgOutTrailing =
    shapes.slice(-6).reduce((s, r) => s + r.payroll + r.opex + r.debt + r.capex + r.uncatOut, 0) /
    6;
  // Spec 65-S: demo threshold ≈ $400k (scale-aware would land near this on Tim books)
  const threshold = 400_000;
  log(
    `trailing avg outflow=${Math.round(avgOutTrailing)}; demo threshold=${threshold} (scale-aware would be ${scaleAwareMinCashThreshold(avgOutTrailing)})`
  );

  const params = defaultCashModelParams();
  const scenarios = defaultCashModelScenarios(threshold);

  const model = computeCashModel({
    categorySeries: series,
    bucketMap: {},
    openingBalance: OPENING_TARGET,
    asOf: AS_OF,
    params,
    scenarios,
    excludedMonthSet: new Set(),
  });
  if (model.refused) throw new Error(`model refused: ${model.refuseReason}`);

  const baseSum = model.summaries.find((s) => s.scenarioId === "base")!;
  const downSum = model.summaries.find((s) => s.scenarioId === "downside")!;
  const interventions = computeCashModelInterventions(
    toComputeInput(
      { categorySeries: series, openingBalance: OPENING_TARGET, asOf: AS_OF },
      params,
      scenarios
    ),
    "base"
  );
  const coll10 = interventions.find(
    (i) => i.bucket === "collections" && i.factorMultiplier === 1.1
  );
  const runway = buildRunwayStatus(model.summaries, params);

  // Seed account + transactions
  const { error: acctErr } = await admin.from("treasury_accounts").upsert(
    {
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      name: "Operating — Tim demo",
      type: "depository",
      source: "csv",
      current_balance: OPENING_TARGET,
      available_balance: OPENING_TARGET,
      iso_currency_code: "USD",
    },
    { onConflict: "client_user_id,account_id" }
  );
  if (acctErr) throw new Error(`account: ${acctErr.message}`);

  const rows: Array<Record<string, unknown>> = [];
  for (const s of shapes) {
    const d = `${s.ym}-15`;
    rows.push({
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      source: "csv",
      external_id: `demo-coll-${s.ym}`,
      posted_date: d,
      amount: s.collections,
      direction: "in",
      iso_currency_code: "USD",
      raw_name: "CUSTOMER COLLECTIONS",
      merchant_name: "Customer collections",
      normalized_merchant: "CUSTOMER COLLECTIONS",
      label: "Customer collections",
      label_source: "manual",
      pending: false,
      is_removed: false,
    });
    rows.push({
      client_user_id: clientId,
      account_id: ACCOUNT_ID,
      source: "csv",
      external_id: `demo-pay-${s.ym}`,
      posted_date: d,
      amount: s.payroll,
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
      external_id: `demo-opex-${s.ym}`,
      posted_date: d,
      amount: s.opex,
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
    if (s.debt > 0) {
      rows.push({
        client_user_id: clientId,
        account_id: ACCOUNT_ID,
        source: "csv",
        external_id: `demo-debt-${s.ym}`,
        posted_date: `${s.ym}-28`,
        amount: s.debt,
        direction: "out",
        iso_currency_code: "USD",
        raw_name: "DEBT SERVICE",
        merchant_name: "Debt service",
        normalized_merchant: "DEBT SERVICE",
        label: "Debt service",
        label_source: "manual",
        pending: false,
        is_removed: false,
      });
    }
    if (s.capex > 0) {
      rows.push({
        client_user_id: clientId,
        account_id: ACCOUNT_ID,
        source: "csv",
        external_id: `demo-capex-${s.ym}`,
        posted_date: `${s.ym}-10`,
        amount: s.capex,
        direction: "out",
        iso_currency_code: "USD",
        raw_name: "CAPEX",
        merchant_name: "Capex",
        normalized_merchant: "CAPEX",
        label: "Capex",
        label_source: "manual",
        pending: false,
        is_removed: false,
      });
    }
    if (s.uncatOut > 0) {
      rows.push({
        client_user_id: clientId,
        account_id: ACCOUNT_ID,
        source: "csv",
        external_id: `demo-uncat-${s.ym}`,
        posted_date: `${s.ym}-22`,
        amount: s.uncatOut,
        direction: "out",
        iso_currency_code: "USD",
        raw_name: "MISC VENDOR",
        merchant_name: "Misc vendor",
        normalized_merchant: "MISC VENDOR",
        label: null,
        pending: false,
        is_removed: false,
      });
    }
  }

  const { error: txErr } = await admin.from("treasury_transactions").insert(rows);
  if (txErr) throw new Error(`txs: ${txErr.message}`);

  const { data: study, error: stErr } = await admin
    .from("treasury_studies")
    .insert({
      client_user_id: clientId,
      name: "Primary cash model",
      type: "cash_model",
      is_primary: true,
      scope: { accountId: ACCOUNT_ID, label: null },
      params,
      scenarios,
      derived_snapshot: {
        bucketBaselines: model.bucketBaselines,
        coveragePct: model.coveragePct,
        bucketMap: {},
        openingBalance: OPENING_TARGET,
        asOf: AS_OF,
        historyMonthCount: model.completeMonths.length,
        historyDerived: true,
        runwayStatus: runway,
      },
    })
    .select("id")
    .single();
  if (stErr || !study) throw new Error(`study: ${stErr?.message}`);

  // Verification (do not wipe — persistent demo)
  const baseBreachMo = baseSum.breachMonth
    ? Number(baseSum.breachMonth.slice(5, 7)) -
      7 +
      (baseSum.runwayMonths ?? 0)
    : null;
  const ok = {
    baseRunway: baseSum.runwayMonths,
    baseBreach: baseSum.breachMonth,
    downBreach: downSum.breachMonth,
    downRunway: downSum.runwayMonths,
    coll10Clears: coll10?.clearsBreach ?? false,
    coverage: model.coveragePct,
    threshold,
    opening: OPENING_TARGET,
  };

  log("--- verification ---");
  log(`months seeded=${shapes.length}; txs=${rows.length}`);
  log(
    `coverage=${(model.coveragePct * 100).toFixed(1)}% (want ~85–90)`
  );
  log(
    `base breach=${baseSum.breachMonth} runway=${baseSum.runwayMonths} (want ~9–10)`
  );
  log(
    `downside breach=${downSum.breachMonth} runway=${downSum.runwayMonths} (want ~6)`
  );
  log(
    `+10% collections clears=${coll10?.clearsBreach} benefit=${coll10?.horizonBenefit}`
  );
  log(`threshold=${threshold}; runway chip=${runway.label}`);
  log(`study=${study.id}`);
  log(
    `operator URL: /operator/treasury/clients/${clientId}?tab=analytics`
  );

  const baseOk =
    baseSum.runwayMonths != null &&
    baseSum.runwayMonths >= 8 &&
    baseSum.runwayMonths <= 11;
  const downOk =
    downSum.runwayMonths != null &&
    downSum.runwayMonths >= 4 &&
    downSum.runwayMonths <= 7;
  const covOk = model.coveragePct >= 0.8 && model.coveragePct < 1;
  const clearOk = coll10?.clearsBreach === true;

  if (!baseOk || !downOk || !covOk || !clearOk) {
    console.warn("[seed65S] WARNING — shape missed a demo target:", {
      baseOk,
      downOk,
      covOk,
      clearOk,
      ok,
      baseBreachMo,
    });
    console.warn(
      "[seed65S] Seed still written — retune buildShapes() if demo needs tighter numbers."
    );
  } else {
    log("DEMO SHAPE OK — all feature targets hit");
  }

  log("done — client_2 left intact (not wiped)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
