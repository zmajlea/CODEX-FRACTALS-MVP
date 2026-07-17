/**
 * Import both Summit CSVs via shared upsertTransactions (label-preserving batch).
 *
 * Run: npm run treasury:import-summit
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const CLIENT_EMAIL = "journey1-test@codexone.test";
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
  account: string
) {
  log(`Reading ${filePath}…`);
  const csv = readFileSync(join(ROOT, filePath), "utf8");
  const parsed = parseTreasuryCsv(csv, clientUserId);
  const r = parsed.reconcile;

  console.log(
    `  Parse: ${parsed.rows.length} rows | in $${r.inflowSum.toLocaleString()} | out $${r.outflowSum.toLocaleString()} | end ${account}: $${r.endBalances[account]?.toLocaleString() ?? "n/a"}`
  );

  if (r.rowsNeedingDirection > 0) {
    throw new Error(`${r.rowsNeedingDirection} null-direction rows`);
  }

  const t0 = performance.now();
  await upsertCsvAccounts(admin, clientUserId, parsed.accountLabels);
  const result = await upsertTransactions(admin, clientUserId, parsed.rows, "csv");
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

  log(
    `${filePath}: ${elapsed}s | inserted ${result.inserted} | updated ${result.updated}`
  );
}

async function main() {
  loadEnvLocal();

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admin: AdminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: clientRow, error: clientErr } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();

  if (clientErr || !clientRow) {
    console.error("Client not found:", clientErr?.message ?? "no row");
    process.exit(1);
  }

  const clientUserId = clientRow.id;
  log(`Client: ${clientRow.email} (${clientUserId})`);

  for (const { path: filePath, account } of [
    { path: "docs/summit-ffm-0625.csv", account: "0625" },
    { path: "docs/summit-ffm-0617.csv", account: "0617" },
  ]) {
    log(`\n--- ${filePath} ---`);
    await importFile(admin, clientUserId, filePath, account);
  }

  log("\n--- SQL reconcile (csv:0625) ---");

  let inSum = 0;
  let outSum = 0;
  let nullDir = 0;
  let totalRows = 0;
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data: page, error: pageErr } = await admin
      .from("treasury_transactions")
      .select("direction, amount")
      .eq("client_user_id", clientUserId)
      .eq("account_id", "csv:0625")
      .eq("is_removed", false)
      .eq("pending", false)
      .range(offset, offset + PAGE - 1);

    if (pageErr) throw new Error(pageErr.message);
    if (!page || page.length === 0) break;

    for (const row of page) {
      totalRows += 1;
      if (row.direction === null) {
        nullDir += 1;
        continue;
      }
      if (row.direction === "out") outSum += Number(row.amount);
      else if (row.direction === "in") inSum += Math.abs(Number(row.amount));
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`  DB rows: ${totalRows}`);
  console.log(`  Inflows:  $${Math.round(inSum).toLocaleString()} (expect ~$193,773)`);
  console.log(`  Outflows: $${Math.round(outSum).toLocaleString()} (expect ~$156,407)`);
  console.log(`  Null direction: ${nullDir} (expect 0)`);

  if (
    Math.abs(inSum - 193773) > 5 ||
    Math.abs(outSum - 156407) > 5 ||
    nullDir !== 0
  ) {
    console.error("\nSQL reconcile FAILED — stop and report.");
    process.exit(1);
  }

  console.log("\nAll checks passed. Summit data is in DB for journey1-test.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
