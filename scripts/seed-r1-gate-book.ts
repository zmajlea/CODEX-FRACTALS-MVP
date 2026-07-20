/**
 * Spec 49A — load FFM book onto r1_gate_client_1: 0625 ONLY, never 0617.
 * Creates SELECTHEALTH rule and applies suggestions (leave at suggested).
 *
 * Run after: npm run test:seed:r1-gate
 * Usage: npx tsx scripts/seed-r1-gate-book.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL = "r1_gate_client_1@codexone.test";
const OPERATOR_EMAIL = "r1_gate_operator@codexone.test";
const CSV_PATH = "docs/summit-ffm-0625.csv";

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

async function main() {
  loadEnvLocal();

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin: AdminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });

  const { data: clientRow, error: clientErr } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  if (clientErr || !clientRow) {
    throw new Error(`${CLIENT_EMAIL} not found — run npm run test:seed:r1-gate first`);
  }

  const { data: operatorRow, error: opErr } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  if (opErr || !operatorRow) {
    throw new Error(`${OPERATOR_EMAIL} not found`);
  }

  const clientUserId = clientRow.id;
  log(`Client: ${clientRow.email} (${clientUserId})`);
  log(`Importing ${CSV_PATH} ONLY (0617 forbidden)`);

  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientUserId);
  const r = parsed.reconcile;
  console.log(
    `  Parse: ${parsed.rows.length} rows | in $${r.inflowSum.toLocaleString()} | out $${r.outflowSum.toLocaleString()}`
  );
  if (r.rowsNeedingDirection > 0) {
    throw new Error(`${r.rowsNeedingDirection} null-direction rows`);
  }

  await upsertCsvAccounts(admin, clientUserId, parsed.accountLabels);
  const result = await upsertTransactions(admin, clientUserId, parsed.rows, "csv");
  log(`Upsert: inserted ${result.inserted} | updated ${result.updated}`);

  // One SELECTHEALTH rule — leave matches at suggested
  const { data: existingRule } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("match_merchant", "SELECTHEALTH")
    .eq("assign_label", "SELECTHEALTH")
    .maybeSingle();

  let ruleId = existingRule?.id;
  if (!ruleId) {
    const { data: created, error: ruleErr } = await admin
      .from("treasury_rules")
      .insert({
        client_user_id: clientUserId,
        created_by: operatorRow.id,
        name: "SELECTHEALTH",
        match_merchant: "SELECTHEALTH",
        match_type: "contains",
        amount_min: null,
        amount_max: null,
        direction: null,
        cadence: null,
        assign_label: "SELECTHEALTH",
        active: true,
      })
      .select("id")
      .single();
    if (ruleErr || !created) {
      throw new Error(`rule insert: ${ruleErr?.message ?? "unknown"}`);
    }
    ruleId = created.id;
    log(`Created SELECTHEALTH rule ${ruleId}`);
  } else {
    log(`Reusing SELECTHEALTH rule ${ruleId}`);
  }

  await applyRulesForClient(admin, clientUserId, ruleId);

  const { count: txCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false);
  const { count: accountCount } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId);
  const { count: suggested } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("suggestion_status", "suggested")
    .ilike("suggested_label", "SELECTHEALTH");
  const { count: uncategorized } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .is("label", null);

  // Refuse if 0617 somehow present
  const { count: acct0617 } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .ilike("label", "%0617%");
  if ((acct0617 ?? 0) > 0) {
    throw new Error("0617 account found — abort (R2-BACKLOG transfer bug)");
  }

  console.log("\n--- Record 1 book ---");
  console.log({
    accounts: accountCount,
    transactions: txCount,
    uncategorized,
    selecthealth_suggested: suggested,
  });
  console.log("Expect ~1 account, ~1086 txs, ~244 SELECTHEALTH suggested.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
