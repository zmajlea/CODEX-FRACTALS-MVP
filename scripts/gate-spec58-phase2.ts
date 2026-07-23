/**
 * Spec 58 Phase 2 gate — recategorise confirmed with date scope.
 * On ana_gate_client_4; wipe after. Also re-checks Phase 1 dual-suggest.
 *
 * Usage: npx tsx scripts/gate-spec58-phase2.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import {
  applyRuleActions,
  applyRulesForClient,
  previewRuleApply,
} from "../lib/treasury/apply-rules-for-client";
import type { Database } from "../lib/database.types";
import type { TreasuryRuleRow } from "../lib/treasury/types";

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
  console.log(`[gate58p2] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function wipeClient(admin: AdminClient, clientId: string) {
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

async function createRule(
  admin: AdminClient,
  clientId: string,
  operatorId: string,
  merchant: string,
  label: string
) {
  const { data, error } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: merchant,
      match_merchant: merchant,
      match_type: "contains",
      assign_label: label,
      active: true,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`rule ${merchant}: ${error?.message}`);
  return data as TreasuryRuleRow;
}

async function countSuggested(
  admin: AdminClient,
  clientId: string,
  ruleId: string
) {
  const { count } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("rule_id", ruleId);
  return count ?? 0;
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

  // Seed three states for TERMINAL:
  // 1) Confirm some PURCHASE∩TERMINAL rows (already categorised)
  // 2) Leave other PURCHASE suggestions (alongside)
  // 3) Do NOT suggest on non-PURCHASE TERMINAL rows (uncategorised)
  const purchase = await createRule(
    admin,
    clientId,
    operatorId,
    "PURCHASE",
    "Shopping"
  );
  const appliedP = await applyRulesForClient(admin, clientId, purchase.id);
  assert(appliedP === 55, `PURCHASE suggest ${appliedP}`);

  // Confirm 20 PURCHASE suggestions → rule_confirmed
  const { data: pSugs } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id, suggested_label")
    .eq("rule_id", purchase.id)
    .limit(20);
  const now = new Date().toISOString();
  for (const s of pSugs ?? []) {
    await admin
      .from("treasury_transactions")
      .update({
        label: s.suggested_label,
        label_source: "rule_confirmed",
        labeled_by: operatorId,
        labeled_at: now,
        suggested_by_rule_id: purchase.id,
        suggestion_status: "confirmed",
        suggested_label: null,
      })
      .eq("id", s.transaction_id);
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("transaction_id", s.transaction_id);
  }

  // Manual-label 3 remaining PURCHASE suggestions
  const { data: pLeft } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id")
    .eq("rule_id", purchase.id)
    .limit(3);
  for (const s of pLeft ?? []) {
    await admin
      .from("treasury_transactions")
      .update({
        label: "Handmade",
        label_source: "manual",
        labeled_by: operatorId,
        labeled_at: now,
        suggested_by_rule_id: null,
        suggestion_status: null,
      })
      .eq("id", s.transaction_id);
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("transaction_id", s.transaction_id);
  }

  // New rule that spans all three states: TERMINAL
  // (do not pre-apply COSTCO — that would fill remaining TERMINAL into "alongside")
  const terminal = await createRule(
    admin,
    clientId,
    operatorId,
    "TERMINAL",
    "TerminalFee"
  );

  // ── 1. Breakdown shows three groups; g3 default off path ───────────────
  const bdAll = await previewRuleApply(admin, clientId, terminal);
  log(
    `1 Breakdown TERMINAL: uncat=${bdAll.uncategorised} alongside=${bdAll.suggestedByOthers} cat=${bdAll.alreadyCategorised} manual=${bdAll.manualCategorised} total=${bdAll.total}`
  );
  assert(bdAll.uncategorised > 0, "need uncategorised matches");
  assert(bdAll.suggestedByOthers > 0, "need suggested-by-others matches");
  assert(bdAll.alreadyCategorised > 0, "need already-categorised matches");
  assert(bdAll.manualCategorised > 0, "need manual matches named in breakdown");

  // Default apply (g1+g2 on, g3 off) — Phase 1 path
  const def = await applyRuleActions(admin, clientId, {
    ruleId: terminal.id,
    suggestUncategorised: true,
    suggestAlongside: true,
    recategorise: false,
    actorUserId: operatorId,
  });
  assert(
    def.suggested === bdAll.uncategorised + bdAll.suggestedByOthers,
    `default suggest ${def.suggested} ≠ ${bdAll.uncategorised}+${bdAll.suggestedByOthers}`
  );
  assert(def.recategorised === 0, "default must not recategorise");
  log(`1b Default apply: suggested=${def.suggested} recategorised=0`);

  // ── 2. Opt into recategorise, default all dates ─────────────────────────
  // Re-preview after suggestions (alongside may shift)
  const bdBeforeRecat = await previewRuleApply(admin, clientId, terminal);
  const recatAll = await applyRuleActions(admin, clientId, {
    ruleId: terminal.id,
    suggestUncategorised: false,
    suggestAlongside: false,
    recategorise: true,
    actorUserId: operatorId,
  });
  log(
    `2 Recategorise all: expected=${bdBeforeRecat.alreadyCategorised} got=${recatAll.recategorised} skippedManual=${recatAll.skippedManual}`
  );
  assert(
    recatAll.recategorised === bdBeforeRecat.alreadyCategorised,
    `recategorise count ${recatAll.recategorised} ≠ breakdown ${bdBeforeRecat.alreadyCategorised}`
  );
  assert(
    recatAll.skippedManual === bdBeforeRecat.manualCategorised,
    `skipped manual ${recatAll.skippedManual} ≠ ${bdBeforeRecat.manualCategorised}`
  );

  const { count: auditCount } = await admin
    .from("user_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", operatorId)
    .eq("event_type", "treasury_tx_recategorised");
  assert(
    (auditCount ?? 0) >= recatAll.recategorised,
    `audit rows ${auditCount} < recategorised ${recatAll.recategorised}`
  );
  log(`2b Audit rows written (≥${recatAll.recategorised})`);

  // Manual labels untouched
  const { count: handmadeStill } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("label", "Handmade")
    .eq("label_source", "manual");
  assert((handmadeStill ?? 0) === 3, `manual labels changed: ${handmadeStill}`);

  // ── 3. Narrow date scope ───────────────────────────────────────────────
  // Reset client and rebuild a clean scope test
  await wipeClient(admin, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  const purchase2 = await createRule(
    admin,
    clientId,
    operatorId,
    "PURCHASE",
    "Shopping"
  );
  await applyRulesForClient(admin, clientId, purchase2.id);
  // Confirm all PURCHASE
  const { data: allP } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id, suggested_label")
    .eq("rule_id", purchase2.id);
  for (const s of allP ?? []) {
    await admin
      .from("treasury_transactions")
      .update({
        label: s.suggested_label,
        label_source: "rule_confirmed",
        labeled_by: operatorId,
        labeled_at: now,
        suggested_by_rule_id: purchase2.id,
        suggestion_status: "confirmed",
      })
      .eq("id", s.transaction_id);
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .eq("transaction_id", s.transaction_id);
  }

  const rewrite = await createRule(
    admin,
    clientId,
    operatorId,
    "PURCHASE",
    "Retail"
  );
  // Unique may block same merchant+label — use different assign_label ✓

  const bdFull = await previewRuleApply(admin, clientId, rewrite);
  assert(bdFull.alreadyCategorised === 55, `full cat ${bdFull.alreadyCategorised}`);

  // Find a mid posted_date among confirmed PURCHASE txs
  const { data: sampleTx } = await admin
    .from("treasury_transactions")
    .select("posted_date")
    .eq("client_user_id", clientId)
    .eq("suggested_by_rule_id", purchase2.id)
    .eq("label_source", "rule_confirmed")
    .not("posted_date", "is", null)
    .order("posted_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  assert(sampleTx?.posted_date, "need a posted_date");
  const scopeTo = sampleTx.posted_date as string;

  const bdNarrow = await previewRuleApply(admin, clientId, rewrite, {
    from: null,
    to: scopeTo,
  });
  log(
    `3 Scope to<=${scopeTo}: cat ${bdFull.alreadyCategorised} → ${bdNarrow.alreadyCategorised}`
  );
  assert(
    bdNarrow.alreadyCategorised < bdFull.alreadyCategorised,
    "narrow scope should reduce count"
  );
  assert(bdNarrow.alreadyCategorised > 0, "narrow scope should keep some rows");

  const scoped = await applyRuleActions(admin, clientId, {
    ruleId: rewrite.id,
    suggestUncategorised: false,
    suggestAlongside: false,
    recategorise: true,
    to: scopeTo,
    actorUserId: operatorId,
  });
  assert(
    scoped.recategorised === bdNarrow.alreadyCategorised,
    `scoped rewrite ${scoped.recategorised} ≠ ${bdNarrow.alreadyCategorised}`
  );

  const { count: retailCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("label", "Retail");
  const { count: shoppingLeft } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("label", "Shopping");
  assert((retailCount ?? 0) === scoped.recategorised, "retail count mismatch");
  assert(
    (shoppingLeft ?? 0) === 55 - scoped.recategorised,
    `out-of-scope Shopping left ${shoppingLeft}, expected ${55 - scoped.recategorised}`
  );
  log(
    `3b Scoped rewrite ok: Retail=${retailCount}, Shopping left=${shoppingLeft}`
  );

  // ── 4. Manual excluded (already proven) ────────────────────────────────
  log("4 Manual labels excluded from recategorise — proven in step 2");

  // ── 5. Phase 1 still intact — dual suggest ─────────────────────────────
  await wipeClient(admin, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");
  const p3 = await createRule(admin, clientId, operatorId, "PURCHASE", "Shopping");
  const c3 = await createRule(admin, clientId, operatorId, "COSTCO", "Costco");
  await applyRulesForClient(admin, clientId, p3.id);
  await applyRulesForClient(admin, clientId, c3.id);
  assert((await countSuggested(admin, clientId, p3.id)) === 55, "P1 PURCHASE");
  assert((await countSuggested(admin, clientId, c3.id)) === 7, "P1 COSTCO");
  const { data: dual } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id")
    .eq("rule_id", c3.id);
  let dualN = 0;
  for (const row of dual ?? []) {
    const { count } = await admin
      .from("treasury_transaction_suggestions")
      .select("transaction_id", { count: "exact", head: true })
      .eq("transaction_id", row.transaction_id);
    if ((count ?? 0) >= 2) dualN += 1;
  }
  assert(dualN === 6, `P1 dual expect 6, got ${dualN}`);
  log("5 Phase 1 dual-suggest intact (55 / 7 / 6 dual)");

  await wipeClient(admin, clientId);
  console.log("\n=== Spec 58 Phase 2 PASS ===");
  console.log({
    breakdown_groups: true,
    default_g3_off: true,
    recategorise_all_matches_breakdown: true,
    audit_written: true,
    date_scope_narrows: true,
    manual_excluded: true,
    phase1_intact: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
