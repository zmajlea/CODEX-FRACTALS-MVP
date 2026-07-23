/**
 * Spec 58 foundation checks (standalone, before Spec 61).
 * Against the linked prod DB via service role.
 *
 * 1) has_pending_suggestion ≡ EXISTS(suggestion) after confirm/reject/delete churn
 * 2) Single-rule apply latency on HCCLAIMPMT (~546)
 *
 * Usage: npx tsx scripts/check-spec58-foundation.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import { fetchAllRows } from "../lib/treasury/fetch-all-rows";
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
  console.log(`[foundation58] ${msg}`);
}

async function wipeClient(admin: AdminClient, clientId: string) {
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

async function reconcilePendingFlag(
  admin: AdminClient,
  clientId: string
): Promise<{ scanned: number; mismatches: number; samples: string[] }> {
  const rows = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("id, has_pending_suggestion")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const sugRows = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transaction_suggestions")
      .select("transaction_id")
      .eq("client_user_id", clientId)
      .order("transaction_id", { ascending: true })
      .range(from, to)
  );
  const exists = new Set(sugRows.map((s) => s.transaction_id));

  let mismatches = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const flag = !!r.has_pending_suggestion;
    const ex = exists.has(r.id);
    if (flag !== ex) {
      mismatches += 1;
      if (samples.length < 10) {
        samples.push(`${r.id} flag=${flag} exists=${ex}`);
      }
    }
  }
  return { scanned: rows.length, mismatches, samples };
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
  if (!clientRow) throw new Error(`${CLIENT_EMAIL} missing`);
  const { data: operatorRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  if (!operatorRow) throw new Error(`${OPERATOR_EMAIL} missing`);

  const clientId = clientRow.id;
  const operatorId = operatorRow.id;
  log(`Scratch client: ${clientRow.email} (${clientId})`);
  log(`Target DB: ${url}`);

  await wipeClient(admin, clientId);
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  // ── Apply latency: HCCLAIMPMT (~546) ───────────────────────────────────
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
  if (hccErr || !hcc) throw new Error(`HCC insert: ${hccErr?.message}`);

  const t0 = performance.now();
  const applied = await applyRulesForClient(admin, clientId, hcc.id);
  const applyMs = Math.round(performance.now() - t0);
  log(`APPLY LATENCY: HCCLAIMPMT suggested=${applied} in ${applyMs}ms`);

  // Also apply SELECTHEALTH for overlap churn
  const { data: sh } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "SELECTHEALTH",
      match_merchant: "SELECTHEALTH",
      match_type: "contains",
      assign_label: "SelectHealth",
      active: true,
    })
    .select("*")
    .single();
  if (!sh) throw new Error("SELECTHEALTH insert failed");
  await applyRulesForClient(admin, clientId, sh.id);

  const beforeChurn = await reconcilePendingFlag(admin, clientId);
  log(
    `Pre-churn reconcile: scanned=${beforeChurn.scanned} mismatches=${beforeChurn.mismatches}`
  );

  // ── Churn: confirm / reject / delete ───────────────────────────────────
  const { data: hccSugs } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id, suggested_label")
    .eq("rule_id", hcc.id)
    .limit(30);

  const now = new Date().toISOString();
  // Confirm 10
  for (const s of (hccSugs ?? []).slice(0, 10)) {
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
  }
  // Reject 10 (HCC only — leave other suggestions if any)
  for (const s of (hccSugs ?? []).slice(10, 20)) {
    await admin.from("treasury_rule_rejections").upsert({
      transaction_id: s.transaction_id,
      rule_id: hcc.id,
      rejected_by: operatorId,
    });
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("transaction_id", s.transaction_id)
      .eq("rule_id", hcc.id);
  }
  // Delete SELECTHEALTH rule (cascade remaining SH suggestions)
  await admin.from("treasury_rules").delete().eq("id", sh.id);

  const afterChurn = await reconcilePendingFlag(admin, clientId);
  log(
    `Post-churn reconcile: scanned=${afterChurn.scanned} mismatches=${afterChurn.mismatches}`
  );
  if (afterChurn.samples.length) {
    log(`Mismatch samples:\n  ${afterChurn.samples.join("\n  ")}`);
  }

  await wipeClient(admin, clientId);

  const driftOk = beforeChurn.mismatches === 0 && afterChurn.mismatches === 0;
  // Acceptable: sub-second to a few seconds for ~500 upserts; flag if >15s
  const latencyOk = applyMs <= 15000;
  const latencyNote =
    applyMs <= 3000
      ? "good"
      : applyMs <= 8000
        ? "acceptable"
        : applyMs <= 15000
          ? "slow-but-usable"
          : "FAIL-too-slow";

  console.log("\n=== Spec 58 foundation report ===");
  console.log({
    db: url,
    apply_latency_ms: applyMs,
    apply_suggested: applied,
    apply_verdict: latencyNote,
    drift_pre_churn_mismatches: beforeChurn.mismatches,
    drift_post_churn_mismatches: afterChurn.mismatches,
    drift_scanned: afterChurn.scanned,
    drift_ok: driftOk,
    foundation_ok: driftOk && latencyOk,
  });

  if (!driftOk || !latencyOk) {
    console.error(
      "\nFOUNDATION FAIL — Spec 58 hotfix before Spec 61. Do not build facets."
    );
    process.exit(1);
  }
  console.log("\nFOUNDATION PASS — safe to proceed with Spec 61.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
