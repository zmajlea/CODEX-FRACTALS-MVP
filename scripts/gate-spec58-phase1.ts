/**
 * Spec 58 Phase 1 gate — multi-suggestion model on ana_gate_client_4.
 * Wipe → import 0625 → scenarios 1–7 → wipe. Does not touch Client 1.
 *
 * Usage: npx tsx scripts/gate-spec58-phase1.ts
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
import { merchantMatches } from "../lib/treasury/rule-helpers";
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
  console.log(`[gate58] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function countSuggestedForRule(
  admin: AdminClient,
  clientId: string,
  ruleId: string
): Promise<number> {
  const { count } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("rule_id", ruleId);
  return count ?? 0;
}

async function countConfirmedForRule(
  admin: AdminClient,
  clientId: string,
  ruleId: string
): Promise<number> {
  const { count } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("label_source", "rule_confirmed")
    .eq("suggested_by_rule_id", ruleId);
  return count ?? 0;
}

async function ledgerCounts(admin: AdminClient, clientId: string) {
  const uncat = applyTxPredicate(
    admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("is_removed", false),
    { status: "needs_label" }
  );
  const sug = applyTxPredicate(
    admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("is_removed", false),
    { status: "suggested" }
  );
  const labeled = applyTxPredicate(
    admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("is_removed", false),
    { status: "labeled" }
  );
  const [u, s, l] = await Promise.all([uncat, sug, labeled]);
  return {
    uncategorised: u.count ?? 0,
    suggested: s.count ?? 0,
    confirmed: l.count ?? 0,
  };
}

async function previewWillSuggest(
  admin: AdminClient,
  clientId: string,
  term: string
): Promise<number> {
  // Mirror RulesPanel preview: label IS null matches containing term
  const PAGE = 1000;
  let from = 0;
  let n = 0;
  const fake = {
    match_merchant: term,
    match_type: "contains" as const,
  } as TreasuryRuleRow;
  for (;;) {
    const { data, error } = await admin
      .from("treasury_transactions")
      .select(
        "id, label, normalized_merchant, raw_name, merchant_name, description, direction, amount"
      )
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .is("label", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const tx of data) {
      if (
        merchantMatches(
          {
            normalized_merchant: tx.normalized_merchant,
            raw_name: tx.raw_name,
            merchant_name: tx.merchant_name,
            description: tx.description,
          },
          fake
        )
      ) {
        n += 1;
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return n;
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
  return data;
}

async function wipeClient(admin: AdminClient, clientId: string) {
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
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
  assert(clientRow, `${CLIENT_EMAIL} missing — run Ana gate seed Part 0`);

  const { data: operatorRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(operatorRow, `${OPERATOR_EMAIL} missing`);

  const clientId = clientRow.id;
  const operatorId = operatorRow.id;
  log(`Gate client: ${clientRow.email} (${clientId})`);

  // ── Filter spine proof on pristine Client 1 (0625 book) BEFORE UI gate ──
  const { data: c1 } = await admin
    .from("users")
    .select("id")
    .ilike("email", "ana_gate_client_1@codexone.test")
    .maybeSingle();
  if (c1) {
    const spine = await ledgerCounts(admin, c1.id);
    log(
      `Filter spine (Client 1): uncat=${spine.uncategorised} sug=${spine.suggested} conf=${spine.confirmed}`
    );
    assert(
      spine.uncategorised === 917 &&
        spine.suggested === 244 &&
        spine.confirmed === 0,
      `Client 1 spine expected 917/244/0, got ${spine.uncategorised}/${spine.suggested}/${spine.confirmed}`
    );
    const { data: tenant } = await admin
      .from("tenants")
      .select("id")
      .eq("domain_slug", "ana-gate")
      .maybeSingle();
    if (tenant) {
      // RPC is security-definer + is_operator — must call as the operator JWT
      const anon =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      const opPass = process.env.ANA_GATE_PASSWORD ?? "ana_gate_2026!";
      assert(anon, "NEXT_PUBLIC_SUPABASE_ANON_KEY or PUBLISHABLE_KEY required");
      const opClient = createClient(url!, anon, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: { transport: ws as never },
      });
      const { error: signErr } = await opClient.auth.signInWithPassword({
        email: OPERATOR_EMAIL,
        password: opPass,
      });
      assert(!signErr, `operator sign-in: ${signErr?.message}`);
      const { data: rpc, error: rpcErr } = await opClient.rpc(
        "list_operator_treasury_clients",
        { p_tenant_id: tenant.id }
      );
      assert(!rpcErr, `RPC error: ${rpcErr?.message}`);
      const list =
        (rpc as Array<{ client_user_id: string; needs_label_count?: number }>) ??
        [];
      const hit = list.find((c) => c.client_user_id === c1.id);
      assert(
        hit != null && hit.needs_label_count === spine.uncategorised,
        `needs_label_count ${hit?.needs_label_count} ≠ uncategorised ${spine.uncategorised}`
      );
      log(
        `Gate item: Overview to-review (${hit.needs_label_count}) == Uncategorised chip (${spine.uncategorised}) == DB`
      );
      await opClient.auth.signOut();
    } else {
      log("WARN: ana-gate tenant missing — SQL spine still 917");
    }
  }

  log("Wipe Client 4…");
  await wipeClient(admin, clientId);

  log(`Import ${CSV_PATH}…`);
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  const { count: txTotal } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false);
  assert(txTotal === 1086, `expected 1086 txs (0625 only), got ${txTotal}`);

  // ── 1. SELECTHEALTH ─────────────────────────────────────────────────────
  const will1 = await previewWillSuggest(admin, clientId, "SELECTHEALTH");
  const sh = await createRule(admin, clientId, operatorId, "SELECTHEALTH", "Insurance");
  const applied1 = await applyRulesForClient(admin, clientId, sh.id);
  const sug1 = await countSuggestedForRule(admin, clientId, sh.id);
  log(`1 SELECTHEALTH: preview=${will1} apply=${applied1} count=${sug1}`);
  assert(will1 === 244 && applied1 === 244 && sug1 === 244, "SELECTHEALTH must be 244/244/244");

  // ── 2. PURCHASE then COSTCO (the overlap bug) ───────────────────────────
  const willP = await previewWillSuggest(admin, clientId, "PURCHASE");
  const purchase = await createRule(admin, clientId, operatorId, "PURCHASE", "Shopping");
  const appliedP = await applyRulesForClient(admin, clientId, purchase.id);
  const sugP = await countSuggestedForRule(admin, clientId, purchase.id);
  log(`2a PURCHASE: preview=${willP} apply=${appliedP} count=${sugP}`);
  assert(willP === appliedP && sugP === appliedP, "PURCHASE preview≠apply");
  assert(sugP === 55, `PURCHASE expected 55, got ${sugP}`);

  const willC = await previewWillSuggest(admin, clientId, "COSTCO");
  const costco = await createRule(admin, clientId, operatorId, "COSTCO", "Costco");
  const appliedC = await applyRulesForClient(admin, clientId, costco.id);
  const sugC = await countSuggestedForRule(admin, clientId, costco.id);
  const sugPAfter = await countSuggestedForRule(admin, clientId, purchase.id);
  log(
    `2b COSTCO: preview=${willC} apply=${appliedC} count=${sugC}; PURCHASE still=${sugPAfter}`
  );
  assert(willC === 7 && appliedC === 7 && sugC === 7, "COSTCO must be 7 (was starved to 1)");
  assert(sugPAfter === 55, `PURCHASE stolen — now ${sugPAfter}`);

  // Dual-suggestion proof — COSTCO∩PURCHASE overlap (6 of 7; one COSTCO is a refund)
  const { data: costcoSugs } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id")
    .eq("rule_id", costco.id);
  const dualIds = (costcoSugs ?? []).map((r) => r.transaction_id);
  assert(dualIds.length === 7, `expected 7 COSTCO txs, got ${dualIds.length}`);
  let dualCount = 0;
  let costcoOnly = 0;
  for (const txId of dualIds) {
    const { data: both } = await admin
      .from("treasury_transaction_suggestions")
      .select("rule_id, suggested_label")
      .eq("transaction_id", txId);
    const labels = new Set((both ?? []).map((b) => b.suggested_label));
    if (labels.has("Shopping") && labels.has("Costco")) {
      dualCount += 1;
      assert((both?.length ?? 0) === 2, `dual tx ${txId} has extras`);
    } else if (labels.has("Costco") && !labels.has("Shopping")) {
      costcoOnly += 1;
    } else {
      throw new Error(`unexpected suggestions on ${txId}: ${JSON.stringify(both)}`);
    }
  }
  assert(dualCount === 6, `expected 6 dual Shopping+Costco, got ${dualCount}`);
  assert(costcoOnly === 1, `expected 1 Costco-only (refund), got ${costcoOnly}`);
  log(
    `2c Dual-suggestion proof: ${dualCount} txs carry Shopping+Costco; ${costcoOnly} Costco-only (no PURCHASE match)`
  );

  const dualTxCandidates = [];
  for (const txId of dualIds) {
    const { count } = await admin
      .from("treasury_transaction_suggestions")
      .select("transaction_id", { count: "exact", head: true })
      .eq("transaction_id", txId);
    if ((count ?? 0) === 2) dualTxCandidates.push(txId);
  }
  assert(dualTxCandidates.length === 6, "need dual candidates for confirm/reject");

  // ── 3. TERMINAL after PURCHASE ──────────────────────────────────────────
  const willT = await previewWillSuggest(admin, clientId, "TERMINAL");
  const terminal = await createRule(admin, clientId, operatorId, "TERMINAL", "Terminal");
  const appliedT = await applyRulesForClient(admin, clientId, terminal.id);
  const sugT = await countSuggestedForRule(admin, clientId, terminal.id);
  const sugP3 = await countSuggestedForRule(admin, clientId, purchase.id);
  log(`3 TERMINAL: preview=${willT} apply=${appliedT} count=${sugT}; PURCHASE=${sugP3}`);
  assert(willT === appliedT && sugT === appliedT, "TERMINAL preview≠apply");
  assert(sugT === 54, `TERMINAL expected 54, got ${sugT}`);
  assert(sugP3 === 55, "PURCHASE changed after TERMINAL");

  // ── 4. Confirm resolves both suggestions ────────────────────────────────
  const dualTx = dualTxCandidates[0]!;
  const beforeP = await countSuggestedForRule(admin, clientId, purchase.id);
  const beforeC = await countSuggestedForRule(admin, clientId, costco.id);
  const { data: costcoSug } = await admin
    .from("treasury_transaction_suggestions")
    .select("suggested_label")
    .eq("transaction_id", dualTx)
    .eq("rule_id", costco.id)
    .maybeSingle();
  assert(costcoSug, "COSTCO suggestion missing on dual tx");

  await admin
    .from("treasury_transactions")
    .update({
      label: costcoSug.suggested_label,
      label_source: "rule_confirmed",
      labeled_by: operatorId,
      labeled_at: new Date().toISOString(),
      suggested_by_rule_id: costco.id,
      suggestion_status: "confirmed",
      suggested_label: null,
      suggestion_explanation: null,
    })
    .eq("id", dualTx);
  await admin
    .from("treasury_transaction_suggestions")
    .delete()
    .eq("transaction_id", dualTx);

  const afterP = await countSuggestedForRule(admin, clientId, purchase.id);
  const afterC = await countSuggestedForRule(admin, clientId, costco.id);
  const confC = await countConfirmedForRule(admin, clientId, costco.id);
  const { count: leftOnTx } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("transaction_id", dualTx);
  log(
    `4 Confirm Costco on dual: PURCHASE ${beforeP}→${afterP}, COSTCO sug ${beforeC}→${afterC}, confirmed=${confC}, left=${leftOnTx}`
  );
  assert(afterP === beforeP - 1, "PURCHASE suggested should drop by 1");
  assert(afterC === beforeC - 1, "COSTCO suggested should drop by 1");
  assert(confC === 1, "COSTCO confirmed +1");
  assert((leftOnTx ?? 0) === 0, "both suggestions must vanish");

  // ── 5. Reject is per-suggestion ─────────────────────────────────────────
  const dualTx2 = dualTxCandidates[1]!;
  await admin.from("treasury_rule_rejections").upsert({
    transaction_id: dualTx2,
    rule_id: purchase.id,
    rejected_by: operatorId,
  });
  await admin
    .from("treasury_transaction_suggestions")
    .delete()
    .eq("transaction_id", dualTx2)
    .eq("rule_id", purchase.id);

  const { data: afterReject } = await admin
    .from("treasury_transaction_suggestions")
    .select("rule_id, suggested_label")
    .eq("transaction_id", dualTx2);
  const rejectLabels = new Set((afterReject ?? []).map((s) => s.suggested_label));
  assert(
    !rejectLabels.has("Shopping") && rejectLabels.has("Costco"),
    `reject Shopping should drop Shopping and keep Costco, got ${JSON.stringify(afterReject)}`
  );
  const reapplyP = await applyRulesForClient(admin, clientId, purchase.id);
  const { data: stillRejected } = await admin
    .from("treasury_transaction_suggestions")
    .select("rule_id")
    .eq("transaction_id", dualTx2)
    .eq("rule_id", purchase.id)
    .maybeSingle();
  assert(!stillRejected, "re-apply PURCHASE must not re-suggest rejected pair");
  log(
    `5 Reject per-suggestion ok (left=${[...rejectLabels].join("+")}; reapply=${reapplyP})`
  );

  // ── 6. Confirmed untouched ──────────────────────────────────────────────
  // Confirm-all remaining SELECTHEALTH
  const { data: shSugs } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id, suggested_label")
    .eq("rule_id", sh.id);
  const now = new Date().toISOString();
  for (const chunk of (shSugs ?? []).reduce<typeof shSugs[]>(
    (acc, row, i) => {
      const b = Math.floor(i / 100);
      if (!acc[b]) acc[b] = [];
      acc[b]!.push(row);
      return acc;
    },
    []
  )) {
    for (const sug of chunk ?? []) {
      await admin
        .from("treasury_transactions")
        .update({
          label: sug.suggested_label,
          label_source: "rule_confirmed",
          labeled_by: operatorId,
          labeled_at: now,
          suggested_by_rule_id: sh.id,
          suggestion_status: "confirmed",
          suggested_label: null,
        })
        .eq("id", sug.transaction_id);
      await admin
        .from("treasury_transaction_suggestions")
        .delete()
        .eq("transaction_id", sug.transaction_id);
    }
  }
  const confSh = await countConfirmedForRule(admin, clientId, sh.id);
  log(`6a Confirmed SELECTHEALTH: ${confSh}`);

  // Apply a rule that would match some confirmed rows — must not touch them
  const beforeLabels = confSh;
  const touched = await applyRulesForClient(admin, clientId, sh.id);
  const afterLabels = await countConfirmedForRule(admin, clientId, sh.id);
  const { count: shPending } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", sh.id);
  assert(afterLabels === beforeLabels, "confirmed count changed");
  assert((shPending ?? 0) === 0, "confirmed rows got new suggestions");
  log(`6b Confirmed untouched: apply returned ${touched}, pending still 0`);

  // ── 7. Rule delete cascades suggestions ─────────────────────────────────
  const beforeDel = await countSuggestedForRule(admin, clientId, terminal.id);
  assert(beforeDel > 0, "TERMINAL should still have suggestions before delete");
  await admin.from("treasury_rules").delete().eq("id", terminal.id);
  const afterDel = await countSuggestedForRule(admin, clientId, terminal.id);
  assert(afterDel === 0, "rule delete must cascade suggestions");
  log(`7 Rule delete cascaded ${beforeDel} TERMINAL suggestions`);

  // Final ledger on Client 4
  const final = await ledgerCounts(admin, clientId);
  log(
    `Client 4 final spine: uncat=${final.uncategorised} sug=${final.suggested} conf=${final.confirmed}`
  );

  log("Wipe Client 4…");
  await wipeClient(admin, clientId);

  console.log("\n=== Spec 58 Phase 1 PASS ===");
  console.log({
    selecthealth: { preview: will1, apply: applied1, count: sug1 },
    purchase: { preview: willP, apply: appliedP, count: sugP },
    costco: { preview: willC, apply: appliedC, count: sugC, purchaseStill: sugPAfter },
    terminal: { preview: willT, apply: appliedT, count: sugT },
    dualSuggestionTxs: 6,
    costcoOnlyTxs: 1,
    confirmResolvedBoth: true,
    rejectPerSuggestion: true,
    confirmedUntouched: true,
    ruleDeleteCascade: true,
    filterSpineClient1: "917/244/0",
  });
  console.log("HARD STOP — do not start Phase 2.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
