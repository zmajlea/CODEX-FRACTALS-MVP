/**
 * Spec 29 import benchmark — same pipeline as POST import-csv route.
 *
 * Usage:
 *   npm run treasury:bench-import -- --file docs/summit-ffm-0625.csv
 *   npm run treasury:bench-import -- --file docs/summit-ffm-0625.csv --rules
 *   npm run treasury:bench-import -- --pair   # 0625 then 0617, SQL reconcile
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const BENCH_EMAIL = "bench-import@codexone.test";
const ROOT = join(__dirname, "..");

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

async function importFile(
  admin: AdminClient,
  clientUserId: string,
  filePath: string,
  applyRules: boolean
) {
  const csv = readFileSync(join(ROOT, filePath), "utf8");
  const t0 = performance.now();

  const parsed = parseTreasuryCsv(csv, clientUserId);
  await upsertCsvAccounts(admin, clientUserId, parsed.accountLabels);
  const result = await upsertTransactions(admin, clientUserId, parsed.rows, "csv");
  if (applyRules) {
    await applyRulesForClient(admin, clientUserId);
  }

  const elapsedMs = performance.now() - t0;
  const r = parsed.reconcile;

  return {
    elapsedMs,
    elapsedSec: (elapsedMs / 1000).toFixed(2),
    parsed,
    result,
    reconcile: {
      rows: parsed.rows.length,
      imported: result.inserted,
      duplicates: result.updated,
      inflow: r.inflowSum,
      outflow: r.outflowSum,
      rowsNeedingDirection: r.rowsNeedingDirection,
    },
  };
}

async function sqlReconcile(admin: AdminClient, clientUserId: string) {
  const PAGE = 1000;
  const byAccount = new Map<string, { in: number; out: number; rows: number }>();

  let offset = 0;
  let nullDir = 0;
  while (true) {
    const { data: page, error } = await admin
      .from("treasury_transactions")
      .select("account_id, direction, amount")
      .eq("client_user_id", clientUserId)
      .eq("source", "csv")
      .eq("is_removed", false)
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!page || page.length === 0) break;

    for (const row of page as Array<{
      account_id: string;
      direction: string | null;
      amount: number;
    }>) {
      if (row.direction === null) {
        nullDir += 1;
        continue;
      }
      const key = row.account_id;
      const entry = byAccount.get(key) ?? { in: 0, out: 0, rows: 0 };
      entry.rows += 1;
      if (row.direction === "out") entry.out += Math.abs(Number(row.amount));
      else entry.in += Math.abs(Number(row.amount));
      byAccount.set(key, entry);
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  console.log("\n--- SQL reconcile ---");
  for (const [acct, v] of [...byAccount.entries()].sort()) {
    console.log(
      `  ${acct}: ${v.rows} rows | in $${Math.round(v.in).toLocaleString()} | out $${Math.round(v.out).toLocaleString()}`
    );
  }
  console.log(`  null direction: ${nullDir} (expect 0)`);

  const a625 = byAccount.get("csv:0625");
  const a617 = byAccount.get("csv:0617");
  const ok625 =
    a625 &&
    Math.abs(a625.in - 193773) <= 2 &&
    Math.abs(a625.out - 156407) <= 2;
  const ok617 =
    a617 &&
    Math.abs(a617.in - 118409) <= 2 &&
    Math.abs(a617.out - 117669) <= 2;

  return { ok625, ok617, nullDir, byAccount };
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
  const fileArg = args.find((a) => a.startsWith("--file="))?.slice(7) ??
    (args.includes("--file") ? args[args.indexOf("--file") + 1] : null);
  const applyRules = args.includes("--rules");
  const setupRule = args.find((a) => a.startsWith("--setup-rule="))?.slice(13) ??
    (args.includes("--setup-rule") ? args[args.indexOf("--setup-rule") + 1] : null);
  const pair = args.includes("--pair");

  const admin: AdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: client, error: clientErr } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", BENCH_EMAIL)
    .maybeSingle();

  if (clientErr || !client) {
    console.error(`Run npm run test:seed:bench-import first`);
    process.exit(1);
  }

  log(`Bench client: ${client.email} (${client.id})`);
  log(`Rules pass: ${applyRules ? "yes" : "no (ingest only)"}`);

  if (setupRule) {
    const operatorId = (
      await admin
        .from("users")
        .select("id")
        .ilike("email", "operator-test@codexone.test")
        .maybeSingle()
    ).data?.id;
    await admin.from("treasury_rules").delete().eq("client_user_id", client.id);
    const { error: ruleErr } = await admin.from("treasury_rules").insert({
      client_user_id: client.id,
      created_by: operatorId ?? client.id,
      name: `Bench ${setupRule}`,
      match_merchant: setupRule,
      match_type: "contains",
      assign_label: "Bench rule label",
      active: true,
    });
    if (ruleErr) throw ruleErr;
    log(`Rule created: match_merchant=${setupRule}`);
  }

  if (pair) {
    for (const f of ["docs/summit-ffm-0625.csv", "docs/summit-ffm-0617.csv"]) {
      const r = await importFile(admin, client.id, f, false);
      console.log(
        `\n${f}: ${r.elapsedSec}s | imported ${r.reconcile.imported} | dup ${r.reconcile.duplicates} | in $${r.reconcile.inflow.toLocaleString()} | out $${r.reconcile.outflow.toLocaleString()}`
      );
    }
    const sql = await sqlReconcile(admin, client.id);
    if (!sql.ok625 || !sql.ok617 || sql.nullDir !== 0) process.exit(1);
    console.log("\nPair reconcile OK");
    return;
  }

  const file = fileArg ?? "docs/summit-ffm-0625.csv";
  const r = await importFile(admin, client.id, file, applyRules);
  console.log(
    `\n${file}: ${r.elapsedSec}s wall-clock`
  );
  console.log(
    `  imported ${r.reconcile.imported} | duplicates ${r.reconcile.duplicates} | direction-null ${r.reconcile.rowsNeedingDirection}`
  );
  console.log(
    `  in $${r.reconcile.inflow.toLocaleString()} | out $${r.reconcile.outflow.toLocaleString()}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
