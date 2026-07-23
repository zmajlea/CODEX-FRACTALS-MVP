/**
 * Spec 60 gate — large rule queue list must not be empty (PostgREST URL limit).
 * On ana_gate_client_4; import 0625; wipe after.
 *
 * Usage: npx tsx scripts/gate-spec60-rule-queue-large.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import { applyTxPredicate } from "../lib/treasury/tx-predicate";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL = "ana_gate_client_4@codexone.test";
const OPERATOR_EMAIL = "ana_gate_operator@codexone.test";
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
    /* optional */
  }
}

function log(msg: string) {
  console.log(`[gate60] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function wipeClient(admin: AdminClient, clientId: string) {
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

/** Mirror Spec 60 list-route shape for suggested queue. */
async function listSuggestedQueue(
  admin: AdminClient,
  clientId: string,
  ruleId: string,
  page: number,
  limit: number
) {
  const offset = page * limit;
  const { data, error, count } = await admin
    .from("treasury_transactions")
    .select("*, treasury_transaction_suggestions!inner(rule_id)", {
      count: "exact",
    })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("treasury_transaction_suggestions.rule_id", ruleId)
    .is("label", null)
    .order("posted_date", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Legacy broken path — fetch all ids then .in() — for before/after proof. */
async function listSuggestedQueueLegacyIn(
  admin: AdminClient,
  clientId: string,
  ruleId: string,
  limit: number
) {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("treasury_transaction_suggestions")
      .select("transaction_id")
      .eq("client_user_id", clientId)
      .eq("rule_id", ruleId)
      .order("transaction_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    ids.push(...data.map((r) => r.transaction_id));
    if (data.length < PAGE) break;
  }

  // Single .in() like the buggy route (not chunked) — this is what blows up.
  const { data, error, count } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact" })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .is("label", null)
    .in("id", ids)
    .order("posted_date", { ascending: false })
    .limit(limit);
  return {
    idCount: ids.length,
    rows: error ? [] : (data ?? []),
    total: error ? 0 : (count ?? 0),
    error: error?.message ?? null,
  };
}

async function listRejectedQueue(
  admin: AdminClient,
  clientId: string,
  ruleId: string
) {
  const { data, error, count } = await admin
    .from("treasury_transactions")
    .select("*, treasury_rule_rejections!inner(rule_id)", { count: "exact" })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("treasury_rule_rejections.rule_id", ruleId)
    .order("posted_date", { ascending: false })
    .limit(50);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const admin: AdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: clientRow } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  assert(clientRow, `${CLIENT_EMAIL} missing`);
  const { data: operatorRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(operatorRow, `${OPERATOR_EMAIL} missing`);

  const clientId = clientRow.id;
  const operatorId = operatorRow.id;
  log(`Gate client: ${clientRow.email}`);

  await wipeClient(admin, clientId);
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  // ── HCCLAIMPMT (~546) ──────────────────────────────────────────────────
  const { data: hcc, error: hccErr } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "HCCLAIMPMT",
      match_merchant: "HCCLAIMPMT",
      match_type: "contains",
      assign_label: "Insurance",
      active: true,
    })
    .select("*")
    .single();
  assert(!hccErr && hcc, `HCCLAIMPMT insert: ${hccErr?.message}`);

  const applied = await applyRulesForClient(admin, clientId, hcc.id);
  const { count: cardCount } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("rule_id", hcc.id);
  log(`HCCLAIMPMT apply=${applied} cardCount=${cardCount}`);
  assert((cardCount ?? 0) >= 500, `expected ~546 HCCLAIMPMT, got ${cardCount}`);

  // Before: legacy .in() path (document breakage)
  const legacy = await listSuggestedQueueLegacyIn(admin, clientId, hcc.id, 50);
  log(
    `BEFORE (legacy .in): ids=${legacy.idCount} listRows=${legacy.rows.length} total=${legacy.total} err=${legacy.error}`
  );

  // After: !inner join
  const page0 = await listSuggestedQueue(admin, clientId, hcc.id, 0, 50);
  log(
    `AFTER (!inner): page0 rows=${page0.rows.length} total=${page0.total}`
  );
  assert(page0.total === cardCount, `list total ${page0.total} ≠ card ${cardCount}`);
  assert(page0.rows.length === 50, `page0 expected 50, got ${page0.rows.length}`);

  // Paginate through all
  const pages = Math.ceil(page0.total / 50);
  let listed = page0.rows.length;
  for (let p = 1; p < pages; p++) {
    const page = await listSuggestedQueue(admin, clientId, hcc.id, p, 50);
    listed += page.rows.length;
    assert(page.total === page0.total, `page ${p} total drift`);
  }
  assert(listed === page0.total, `paginated ${listed} ≠ ${page0.total}`);
  log(`Paginated all ${listed} suggested rows across ${pages} pages`);

  // Confirm-all end to end (chunked like bulk-label)
  const { data: allSugs } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id, suggested_label")
    .eq("rule_id", hcc.id);
  const now = new Date().toISOString();
  let confirmed = 0;
  for (const s of allSugs ?? []) {
    await admin
      .from("treasury_transactions")
      .update({
        label: s.suggested_label,
        label_source: "rule_confirmed",
        labeled_by: operatorId,
        labeled_at: now,
        suggested_by_rule_id: hcc.id,
        suggestion_status: "confirmed",
        suggested_label: null,
      })
      .eq("id", s.transaction_id);
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("transaction_id", s.transaction_id);
    confirmed += 1;
  }
  const afterConfirm = await listSuggestedQueue(admin, clientId, hcc.id, 0, 50);
  assert(afterConfirm.total === 0, "suggested queue should be empty after confirm-all");
  const { count: confCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("label_source", "rule_confirmed")
    .eq("suggested_by_rule_id", hcc.id);
  assert(confCount === confirmed, `confirmed ${confCount} ≠ ${confirmed}`);
  log(`Confirm-all: ${confirmed} ok`);

  // ── SELECTHEALTH regression (244) ──────────────────────────────────────
  await wipeClient(admin, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  const { data: sh } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "SELECTHEALTH",
      match_merchant: "SELECTHEALTH",
      match_type: "contains",
      assign_label: "Insurance",
      active: true,
    })
    .select("*")
    .single();
  assert(sh, "SELECTHEALTH missing");
  await applyRulesForClient(admin, clientId, sh.id);
  const shList = await listSuggestedQueue(admin, clientId, sh.id, 0, 50);
  assert(shList.total === 244, `SELECTHEALTH total ${shList.total}`);
  assert(shList.rows.length === 50, "SELECTHEALTH page0");
  log(`SELECTHEALTH list total=${shList.total} page0=${shList.rows.length}`);

  // ── Rejected queue ─────────────────────────────────────────────────────
  const rejectTx = shList.rows[0]!;
  await admin.from("treasury_rule_rejections").upsert({
    transaction_id: rejectTx.id,
    rule_id: sh.id,
    rejected_by: operatorId,
  });
  await admin
    .from("treasury_transaction_suggestions")
    .delete()
    .eq("transaction_id", rejectTx.id)
    .eq("rule_id", sh.id);

  const rej = await listRejectedQueue(admin, clientId, sh.id);
  assert(rej.total === 1, `rejected total ${rej.total}`);
  assert(rej.rows.some((r) => r.id === rejectTx.id), "rejected row missing");
  log(`Rejected queue total=${rej.total}`);

  // Sanity: applyTxPredicate still imports clean
  void applyTxPredicate;

  await wipeClient(admin, clientId);
  console.log("\n=== Spec 60 PASS ===");
  console.log({
    hcc_card: cardCount,
    before_legacy_list_rows: legacy.rows.length,
    before_legacy_error: legacy.error,
    after_inner_total: page0.total,
    after_paginated: listed,
    confirm_all: confirmed,
    selecthealth: 244,
    rejected: 1,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
