/**
 * Spec 55 gate — rule reliability + latency on r1_gate_client_2 (not Tim).
 *
 * Wipe → import 0625 → duplicate/idempotency/latency/_ escape → wipe again.
 * Usage: npx tsx scripts/gate-spec55-rule-reliability.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import { escapeIlike } from "../lib/treasury/tx-predicate";
import { merchantMatches } from "../lib/treasury/rule-helpers";
import type { Database } from "../lib/database.types";
import type { TreasuryRuleRow } from "../lib/treasury/types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL = "r1_gate_client_2@codexone.test";
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
    /* optional */
  }
}

function log(msg: string) {
  console.log(`[gate55] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function suggestedForRule(
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

async function wipeClient(admin: AdminClient, clientId: string) {
  // Rejections cascade from rules/transactions FKs.
  await admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", clientId);
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

  // D1 unit: `_` escaped for ILIKE
  const escaped = escapeIlike("A_B");
  assert(escaped === "A\\_B", `escapeIlike('_') → ${escaped}`);
  log("D1 escapeIlike('_') ok");

  const { data: clientRow } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  assert(clientRow, `${CLIENT_EMAIL} missing — run npm run test:seed:r1-gate`);

  const { data: operatorRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(operatorRow, `${OPERATOR_EMAIL} missing`);

  const clientId = clientRow.id;
  log(`Gate client: ${clientRow.email} (${clientId})`);

  log("Wipe…");
  await wipeClient(admin, clientId);

  log(`Import ${CSV_PATH}…`);
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  const upserted = await upsertTransactions(admin, clientId, parsed.rows, "csv");
  log(`Upsert inserted=${upserted.inserted} updated=${upserted.updated}`);

  const { count: txTotal } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false);
  log(`Book size: ${txTotal} txs`);

  // Create SELECTHEALTH rule + time apply (C1 after)
  const { data: rule, error: ruleErr } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorRow.id,
      name: "SELECTHEALTH",
      match_merchant: "SELECTHEALTH",
      match_type: "contains",
      assign_label: "SELECTHEALTH",
      active: true,
    })
    .select("*")
    .single();
  assert(!ruleErr && rule, `rule insert: ${ruleErr?.message}`);

  const t0 = performance.now();
  const applied1 = await applyRulesForClient(admin, clientId, rule.id);
  const ms1 = Math.round(performance.now() - t0);
  const count1 = await suggestedForRule(admin, clientId, rule.id);
  log(`Apply #1: suggested=${applied1} count=${count1} in ${ms1}ms (batched C1)`);
  assert(count1 === 244, `expected 244 SELECTHEALTH suggestions, got ${count1}`);

  // Re-apply — stable (B)
  const t1 = performance.now();
  const applied2 = await applyRulesForClient(admin, clientId, rule.id);
  const ms2 = Math.round(performance.now() - t1);
  const count2 = await suggestedForRule(admin, clientId, rule.id);
  log(`Apply #2 (re-apply): returned=${applied2} count=${count2} in ${ms2}ms`);
  assert(count2 === count1, `re-apply changed count ${count1} → ${count2}`);

  // Forced twin via admin insert (bypass A2) — must steal 0
  const { data: twin, error: twinErr } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorRow.id,
      name: "SELECTHEALTH twin",
      match_merchant: "SELECTHEALTH",
      match_type: "contains",
      assign_label: "SELECTHEALTH",
      active: true,
    })
    .select("*")
    .single();

  if (twinErr) {
    // Unique index may already be live — that's A2 working
    log(`Twin insert blocked by DB (${twinErr.code ?? twinErr.message}) — A2 index live`);
  } else {
    assert(twin, "twin missing");
    const both = await applyRulesForClient(admin, clientId, twin.id);
    const twinCount = await suggestedForRule(admin, clientId, twin.id);
    const firstAfter = await suggestedForRule(admin, clientId, rule.id);
    log(
      `Twin apply (Spec 58 multi-suggest): new=${both} twinCount=${twinCount} firstStill=${firstAfter}`
    );
    // Spec 58: twin adds alongside — no steal. Both rules keep full counts.
    assert(twinCount === count1, `twin should also suggest ${count1}, got ${twinCount}`);
    assert(firstAfter === count1, `first rule count changed to ${firstAfter}`);
    await admin.from("treasury_rules").delete().eq("id", twin.id);
  }

  // Multi-rule path must not crash (B filter branched)
  const tMulti = performance.now();
  const multiApplied = await applyRulesForClient(admin, clientId);
  const msMulti = Math.round(performance.now() - tMulti);
  log(`Multi-rule apply (no ruleId): returned=${multiApplied} in ${msMulti}ms — no crash`);
  const afterMulti = await suggestedForRule(admin, clientId, rule.id);
  assert(afterMulti === count1, `multi-rule apply changed ownership to ${afterMulti}`);

  // A2 pre-check semantics: findActiveDuplicate style
  const { data: dupes } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientId)
    .eq("active", true)
    .eq("match_merchant", "SELECTHEALTH")
    .eq("assign_label", "SELECTHEALTH")
    .eq("match_type", "contains");
  assert(
    (dupes?.length ?? 0) === 1,
    `expected 1 active SELECTHEALTH rule, got ${dupes?.length}`
  );
  log("A2: exactly one active SELECTHEALTH rule");

  // D1 parity: term with `_` — JS includes vs escaped pattern shape
  const underscoreTerm = "POS_";
  const fakeRule = {
    match_merchant: underscoreTerm,
    match_type: "contains" as const,
  } as TreasuryRuleRow;
  const hit = merchantMatches(
    {
      normalized_merchant: "POS_TERMINAL",
      raw_name: null,
      merchant_name: null,
      description: null,
    },
    fakeRule
  );
  assert(hit === true, "contains should match POS_TERMINAL for term POS_");
  assert(
    escapeIlike(underscoreTerm) === "POS\\_",
    "ILIKE escape must treat _ as literal"
  );
  log("D1 `_` preview/apply parity ok");

  // Counts reconcile: unlabeled POS matches
  const { count: posUncat } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .is("label", null)
    .or(
      "normalized_merchant.ilike.%POS%,raw_name.ilike.%POS%,merchant_name.ilike.%POS%,description.ilike.%POS%"
    );
  log(`D2 sample: POS uncategorized matches ≈ ${posUncat} (preview willSuggest)`);

  log("Wipe gate client…");
  await wipeClient(admin, clientId);

  console.log("\n=== Spec 55 PASS ===");
  console.log({
    apply_ms_first: ms1,
    apply_ms_reapply: ms2,
    apply_ms_multi: msMulti,
    selecthealth_suggested: count1,
    note_before_c1:
      "Before: 1 UPDATE per match @ concurrency 15 (~ceil(N/15) RTTs). After: 1–2 batched UPDATEs for identical payload.",
    explanation:
      "New suggestions use rule-level explanation; existing rows keep old per-tx text until re-suggested.",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
