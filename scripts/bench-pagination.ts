/**
 * Spec 31 — pagination kill switch + before/after metrics.
 *
 * Usage:
 *   npm run treasury:bench-pagination -- --phase before
 *   npm run treasury:bench-pagination -- --phase after
 *   npm run treasury:bench-pagination -- --determinism SELECTHEALTH
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv } from "../lib/treasury/csv-import";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import { loadMonthlyOutflows } from "../lib/treasury/load-monthly-outflows";
import {
  computeL0,
  computeSeasonalIndices,
  deriveCompleteMonths,
  fillCompleteMonthAmounts,
  lastNFromCompleteMonths,
  roundBaseDefault,
} from "../lib/treasury/spend-plan";
import { fetchSuggestionSnapshot } from "./snapshot-rule-suggestions";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const BENCH_EMAIL = "bench-import@codexone.test";
const ROOT = join(__dirname, "..");
const ACCOUNT = "csv:0625";
const CSV_PATH = "docs/summit-ffm-0625.csv";
const EXPECT_IN = 193773;
const EXPECT_OUT = 156407;

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
    // optional
  }
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function paginatedSqlTotals(
  admin: AdminClient,
  clientUserId: string,
  accountId: string
) {
  const PAGE = 1000;
  let offset = 0;
  let inSum = 0;
  let outSum = 0;
  let rows = 0;
  let nullDir = 0;

  while (true) {
    const { data: page, error } = await admin
      .from("treasury_transactions")
      .select("direction, amount")
      .eq("client_user_id", clientUserId)
      .eq("account_id", accountId)
      .eq("is_removed", false)
      .eq("pending", false)
      .order("id")
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!page || page.length === 0) break;

    for (const row of page) {
      rows += 1;
      if (row.direction === null) {
        nullDir += 1;
        continue;
      }
      if (row.direction === "out") outSum += Math.abs(Number(row.amount));
      else if (row.direction === "in") inSum += Math.abs(Number(row.amount));
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return { inSum, outSum, rows, nullDir };
}

async function querySummaryTotals(
  admin: AdminClient,
  clientUserId: string,
  accountId: string,
  phase: string
) {
  const opts = {
    bucket: "month" as const,
    accountId,
    from: "2020-01-01",
    to: "2099-12-31",
  };

  if (phase === "before") {
    // Scripts-only: deliberately unpaginated to prove PostgREST still caps at ~1000.
    let q = admin
      .from("treasury_transactions")
      .select("posted_date, amount, direction")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .eq("pending", false)
      .eq("account_id", accountId)
      .gte("posted_date", opts.from)
      .lte("posted_date", opts.to);

    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    let inSum = 0;
    let outSum = 0;
    for (const row of rows) {
      if (row.direction === "in") inSum += Math.abs(Number(row.amount));
      else if (row.direction === "out") outSum += Math.abs(Number(row.amount));
    }
    return { inSum, outSum, count: rows.length, buckets: 0 };
  }

  const { querySummary } = await import("../lib/treasury/query-summary");
  const buckets = await querySummary(admin, clientUserId, opts);

  let inSum = 0;
  let outSum = 0;
  let count = 0;
  for (const b of buckets) {
    inSum += b.inflow;
    outSum += b.outflow;
    count += b.count;
  }
  return { inSum, outSum, count, buckets: buckets.length };
}

export async function countEligibleForRule(
  admin: AdminClient,
  clientUserId: string,
  merchantPattern: string
): Promise<number> {
  const PAGE = 1000;
  let offset = 0;
  let total = 0;

  while (true) {
    const { data: page, error } = await admin
      .from("treasury_transactions")
      .select("id")
      .eq("client_user_id", clientUserId)
      .ilike("normalized_merchant", `%${merchantPattern}%`)
      .eq("is_removed", false)
      .eq("pending", false)
      .is("label", null)
      .order("id")
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!page || page.length === 0) break;
    total += page.length;
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return total;
}

async function countSuggestions(admin: AdminClient, clientUserId: string) {
  const { count, error } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .not("suggested_by_rule_id", "is", null);

  if (error) throw error;
  return count ?? 0;
}

async function clearSuggestions(admin: AdminClient, clientUserId: string) {
  const { error } = await admin
    .from("treasury_transactions")
    .update({
      suggested_label: null,
      suggested_by_rule_id: null,
      suggestion_status: null,
      suggestion_explanation: null,
    })
    .eq("client_user_id", clientUserId);

  if (error) throw error;
}

async function ensureRule(
  admin: AdminClient,
  clientUserId: string,
  matchMerchant: string
): Promise<string> {
  const { data: existing } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("match_merchant", matchMerchant)
    .eq("active", true)
    .maybeSingle();

  if (existing) return existing.id;

  const operatorId = (
    await admin
      .from("users")
      .select("id")
      .ilike("email", "operator-test@codexone.test")
      .maybeSingle()
  ).data?.id;

  const { data: inserted, error } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientUserId,
      created_by: operatorId ?? clientUserId,
      name: `Bench ${matchMerchant}`,
      match_merchant: matchMerchant,
      match_type: "contains",
      assign_label: "Bench rule label",
      active: true,
    })
    .select("id")
    .single();

  if (error) throw error;
  return inserted.id;
}

function csvMonthlyOutflows(clientUserId: string): Record<string, number> {
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientUserId);
  const map: Record<string, number> = {};
  for (const row of parsed.rows) {
    if (row.account_id !== ACCOUNT) continue;
    if (!row.posted_date) continue;
    const amt = Number(row.amount);
    if (amt <= 0) continue;
    const key = `${row.posted_date.slice(0, 7)}-01`;
    map[key] = (map[key] ?? 0) + Math.abs(amt);
  }
  return map;
}

async function sqlMonthlyOutflows(
  admin: AdminClient,
  clientUserId: string
): Promise<Record<string, number>> {
  const PAGE = 1000;
  let offset = 0;
  const map: Record<string, number> = {};

  while (true) {
    const { data: page, error } = await admin
      .from("treasury_transactions")
      .select("posted_date, amount")
      .eq("client_user_id", clientUserId)
      .eq("account_id", ACCOUNT)
      .eq("is_removed", false)
      .eq("pending", false)
      .eq("direction", "out")
      .order("posted_date")
      .order("id")
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!page || page.length === 0) break;

    for (const row of page) {
      if (!row.posted_date) continue;
      const key = `${row.posted_date.slice(0, 7)}-01`;
      map[key] = (map[key] ?? 0) + Math.abs(Number(row.amount));
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return map;
}

async function reportSpendPlanMetrics(
  admin: AdminClient,
  clientUserId: string,
  label: string
) {
  const asOf = "2026-07-14";
  const monthlyOutflows = await loadMonthlyOutflows(admin, clientUserId, {
    accountId: ACCOUNT,
    from: "2020-01-01",
    to: asOf,
  });

  const csvOut = csvMonthlyOutflows(clientUserId);
  const sqlOut = await sqlMonthlyOutflows(admin, clientUserId);
  const complete = deriveCompleteMonths(monthlyOutflows, asOf);
  const filled = fillCompleteMonthAmounts(monthlyOutflows, complete);
  const l0Window = lastNFromCompleteMonths(complete, 6);
  const l0Live = computeL0(filled, l0Window);
  const l0Csv = computeL0(fillCompleteMonthAmounts(csvOut, complete), l0Window);
  const l0Sql = computeL0(fillCompleteMonthAmounts(sqlOut, complete), l0Window);
  const indices = computeSeasonalIndices(filled, complete, asOf);

  console.log(`\n--- Spend plan metrics (${label}) ---`);
  console.log(`  L0 window: ${l0Window.map((m) => m.slice(0, 7)).join(", ")}`);
  console.log(`  L0 live path: $${l0Live != null ? Math.round(l0Live).toLocaleString() : "null"}`);
  console.log(`  L0 SQL agg:   $${l0Sql != null ? Math.round(l0Sql).toLocaleString() : "null"}`);
  console.log(`  L0 CSV parse: $${l0Csv != null ? Math.round(l0Csv).toLocaleString() : "null"}`);
  console.log(`  base default: $${roundBaseDefault(l0Live ?? 0).toLocaleString()}`);
  console.log(`  seasonal indices (1-12): ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => indices.indices[m]?.toFixed(3) ?? "-").join(", ")}`);
}

function matchesSqlTruth(inSum: number, outSum: number): boolean {
  return (
    Math.abs(inSum - EXPECT_IN) <= 2 &&
    Math.abs(outSum - EXPECT_OUT) <= 2
  );
}

async function runPhase(admin: AdminClient, clientUserId: string, phase: string) {
  console.log(`\n========== Spec 31 ${phase.toUpperCase()} ==========`);

  const sql = await paginatedSqlTotals(admin, clientUserId, ACCOUNT);
  const qs = await querySummaryTotals(admin, clientUserId, ACCOUNT, phase);

  console.log("\n--- SQL truth (paginated) ---");
  console.log(`  rows: ${sql.rows} | in $${Math.round(sql.inSum).toLocaleString()} | out $${Math.round(sql.outSum).toLocaleString()} | null dir ${sql.nullDir}`);

  console.log("\n--- querySummary (live path) ---");
  console.log(`  tx count: ${qs.count} | in $${Math.round(qs.inSum).toLocaleString()} | out $${Math.round(qs.outSum).toLocaleString()} | buckets ${qs.buckets}`);

  const inPct = sql.inSum > 0 ? ((qs.inSum - sql.inSum) / sql.inSum) * 100 : 0;
  const outPct = sql.outSum > 0 ? ((qs.outSum - sql.outSum) / sql.outSum) * 100 : 0;
  console.log(`\n  delta in: ${inPct.toFixed(2)}% | delta out: ${outPct.toFixed(2)}%`);

  const qsMatchesSql = matchesSqlTruth(qs.inSum, qs.outSum);

  if (phase === "before") {
    if (qsMatchesSql) {
      console.log("\n*** KILL SWITCH: querySummary already matches SQL truth — diagnosis wrong, STOP ***");
      process.exit(2);
    }
    // Regression: PostgREST cap must still truncate the unpaginated read.
    if (qs.count !== 1000) {
      console.error(
        `\nFAIL: unpaginated --phase before expected exactly 1000 rows (PostgREST cap), got ${qs.count}`
      );
      process.exit(1);
    }
    console.log("\n*** Kill switch PASS: unpaginated read capped at 1000 (≠ SQL) — proceed with pagination fix ***");
  } else {
    if (!qsMatchesSql) {
      console.error("\nFAIL: querySummary still does not match SQL after fix");
      process.exit(1);
    }
    console.log("\nPASS: querySummary matches SQL truth");
  }

  await reportSpendPlanMetrics(admin, clientUserId, phase);
}

async function runDeterminism(
  admin: AdminClient,
  clientUserId: string,
  pattern: string
) {
  console.log(`\n========== Determinism: ${pattern} ==========`);

  const n = await countEligibleForRule(admin, clientUserId, pattern);
  console.log(`N (SQL ilike %${pattern}%): ${n}`);

  const ruleId = await ensureRule(admin, clientUserId, pattern);
  await clearSuggestions(admin, clientUserId);

  const counts: number[] = [];
  const snapPaths: string[] = [];

  for (let run = 1; run <= 3; run++) {
    await clearSuggestions(admin, clientUserId);
    const suggested = await applyRulesForClient(admin, clientUserId, ruleId);
    const dbCount = await countSuggestions(admin, clientUserId);

    console.log(`  run ${run}: applyRules=${suggested} db=${dbCount}`);
    if (suggested !== n || dbCount !== n) {
      console.error(`FAIL: run ${run} expected ${n}, got apply=${suggested} db=${dbCount}`);
      process.exit(1);
    }
    counts.push(suggested);

    const snapPath = `snapshots/spec31-${pattern.toLowerCase()}-run${run}.json`;
    const snapshot = await fetchSuggestionSnapshot(admin, clientUserId);
    mkdirSync(dirname(join(ROOT, snapPath)), { recursive: true });
    writeFileSync(join(ROOT, snapPath), JSON.stringify(snapshot, null, 2), "utf8");
    snapPaths.push(snapPath);
    console.log(`  snapshot: ${snapPath} (${snapshot.length} rows)`);
  }

  const a = JSON.parse(readFileSync(join(ROOT, snapPaths[0]!), "utf8")) as Array<{
    external_id: string;
    suggested_label: string | null;
    suggested_by_rule_id: string | null;
    suggestion_explanation: string | null;
  }>;
  const b = JSON.parse(readFileSync(join(ROOT, snapPaths[1]!), "utf8")) as typeof a;

  const aByExt = new Map(a.map((r) => [r.external_id, r]));
  let mismatches = 0;
  for (const rb of b) {
    const ra = aByExt.get(rb.external_id);
    if (!ra) {
      mismatches += 1;
      console.log(`MISSING external_id ${rb.external_id} in run1`);
      continue;
    }
    if (
      ra.suggested_label !== rb.suggested_label ||
      ra.suggestion_explanation !== rb.suggestion_explanation
    ) {
      mismatches += 1;
    }
  }
  if (a.length !== b.length) mismatches += Math.abs(a.length - b.length);

  if (mismatches > 0) {
    console.error(`FAIL: snapshot diff ${mismatches} mismatch(es)`);
    process.exit(1);
  }

  console.log(`PASS: ${pattern} 3× ${counts[0]} suggestions, byte-identical snapshots (${a.length} rows by external_id)`);
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const phase = args.find((a) => a.startsWith("--phase="))?.slice(8) ??
    (args.includes("--phase") ? args[args.indexOf("--phase") + 1] : null);
  const determinism = args.find((a) => a.startsWith("--determinism="))?.slice(14) ??
    (args.includes("--determinism") ? args[args.indexOf("--determinism") + 1] : null);

  const admin: AdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: client } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", BENCH_EMAIL)
    .maybeSingle();

  if (!client) {
    console.error("Run npm run test:seed:bench-import");
    process.exit(1);
  }

  log(`Bench client: ${client.email} (${client.id})`);

  if (determinism) {
    await runDeterminism(admin, client.id, determinism);
    return;
  }

  if (phase === "before" || phase === "after") {
    await runPhase(admin, client.id, phase);
    return;
  }

  console.error("Usage: --phase before|after | --determinism SELECTHEALTH|CHECK");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
