/**
 * Spec 57 Part 0 — load FFM book onto ana_gate_client_1 only.
 * 0625 + 0871 reserve, SELECTHEALTH suggested, leave Clients 2–4 empty.
 *
 * Run after: npm run test:seed:ana-gate
 * Usage: npx tsx scripts/seed-ana-gate-book.ts
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
const CLIENT_EMAIL = "ana_gate_client_1@codexone.test";
const OPERATOR_EMAIL = "ana_gate_operator@codexone.test";
const CSV_PATHS = [
  "docs/summit-ffm-0625.csv",
  "docs/summit-ffm-0871-reserve.csv",
] as const;

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
    throw new Error(`${CLIENT_EMAIL} not found — run npm run test:seed:ana-gate first`);
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
  log(`Importing ${CSV_PATHS.join(" + ")} (0617 forbidden)`);

  for (const csvPath of CSV_PATHS) {
    log(`\n--- ${csvPath} ---`);
    const csv = readFileSync(join(ROOT, csvPath), "utf8");
    const parsed = parseTreasuryCsv(csv, clientUserId);
    const r = parsed.reconcile;
    console.log(
      `  Parse: ${parsed.rows.length} rows | in $${r.inflowSum.toLocaleString()} | out $${r.outflowSum.toLocaleString()}`
    );
    if (r.rowsNeedingDirection > 0) {
      throw new Error(`${r.rowsNeedingDirection} null-direction rows in ${csvPath}`);
    }

    await upsertCsvAccounts(admin, clientUserId, parsed.accountLabels);
    const result = await upsertTransactions(admin, clientUserId, parsed.rows, "csv");
    log(`Upsert: inserted ${result.inserted} | updated ${result.updated}`);
  }

  const { data: existingRule } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("match_merchant", "SELECTHEALTH")
    .eq("assign_label", "SELECTHEALTH")
    .eq("active", true)
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
    .eq("is_removed", false)
    .is("label", null)
    .eq("has_pending_suggestion", true);
  const { count: labeled } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .not("label", "is", null);
  const { count: needsLabel } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .is("label", null)
    .eq("has_pending_suggestion", false);

  const { count: acct0617 } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .ilike("label", "%0617%");
  if ((acct0617 ?? 0) > 0) {
    throw new Error("0617 account found — abort");
  }

  // Confirm clients 2–4 still empty
  for (const email of [
    "ana_gate_client_2@codexone.test",
    "ana_gate_client_3@codexone.test",
    "ana_gate_client_4@codexone.test",
  ]) {
    const { data: u } = await admin.from("users").select("id").ilike("email", email).maybeSingle();
    if (!u) continue;
    const { count } = await admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", u.id);
    if ((count ?? 0) > 0) {
      throw new Error(`${email} has ${count} txs — Part 0 must leave 2–4 empty`);
    }
  }

  console.log("\n--- Ana Gate Client 1 book (pristine for Ana) ---");
  console.log({
    accounts: accountCount,
    transactions: txCount,
    needs_label: needsLabel,
    suggested,
    labeled,
  });
  console.log("Expect 2 accounts, 1161 txs, 917 needs_label / 244 suggested / 0 labeled.");
  console.log("Clients 2–4 empty. Do not use Client 1 for Spec 57 Parts 1–7.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
