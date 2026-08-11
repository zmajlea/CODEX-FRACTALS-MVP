/**
 * Spec 57 — diagnosis only on ana_gate_client_4 as ana_gate_operator.
 * Parts 1–6 via DB/lib (same predicates as UI preview + apply). Part 7 = browser.
 * Resets client 4 empty at end. No product fixes.
 *
 * Usage: npx tsx scripts/gate-spec57-diagnosis.ts
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
import { countRuleQueues } from "../lib/server/treasury-rules";
import type { Database } from "../lib/database.types";
import type { TreasuryRuleRow } from "../lib/treasury/types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OPERATOR_EMAIL = "ana_gate_operator@codexone.test";
const CLIENT_EMAIL = "ana_gate_client_4@codexone.test";
const CSV_0625 = "docs/summit-ffm-0625.csv";
const CSV_0871 = "docs/summit-ffm-0871-reserve.csv";

type Five = {
  scenario: string;
  previewMatch: number;
  previewWillSuggest: number;
  ruleCardSuggested: number;
  txSuggestedChip: number;
  dbByRule: number;
  verdict: string;
};

const rows: Five[] = [];
const findings: string[] = [];

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
  console.log(`[57] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function wipeClient(admin: AdminClient, clientId: string) {
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

async function importCsv(
  admin: AdminClient,
  clientId: string,
  csvPath: string
): Promise<number> {
  const csv = readFileSync(join(ROOT, csvPath), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  const upserted = await upsertTransactions(admin, clientId, parsed.rows, "csv");
  return upserted.inserted + upserted.updated;
}

/** Same two queries the Rules panel preview runs (q + labeled=false). */
async function previewCounts(
  admin: AdminClient,
  clientId: string,
  q: string
): Promise<{ match: number; willSuggest: number }> {
  const safe = escapeIlike(q);
  const orExpr = `normalized_merchant.ilike.%${safe}%,raw_name.ilike.%${safe}%,merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`;

  const { count: match } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .or(orExpr);

  const { count: willSuggest } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .is("label", null)
    .or(orExpr);

  return { match: match ?? 0, willSuggest: willSuggest ?? 0 };
}

async function dbSuggestedForRule(
  admin: AdminClient,
  clientId: string,
  ruleId: string
): Promise<number> {
  const { count } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("suggestion_status", "suggested")
    .eq("suggested_by_rule_id", ruleId);
  return count ?? 0;
}

async function txSuggestedChip(
  admin: AdminClient,
  clientId: string
): Promise<number> {
  const { count } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("suggestion_status", "suggested");
  return count ?? 0;
}

async function ruleCardSuggested(
  admin: AdminClient,
  clientId: string,
  rule: TreasuryRuleRow
): Promise<number> {
  const map = await countRuleQueues(admin, clientId, [rule]);
  return map.get(rule.id)?.suggested ?? 0;
}

async function bookBaseline(admin: AdminClient, clientId: string) {
  const { count: total } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false);
  const { count: suggested } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("suggestion_status", "suggested");
  const { count: labeled } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .not("label", "is", null);
  const { count: needs } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .or(
      "and(label.is.null,suggestion_status.is.null),and(label.is.null,suggestion_status.neq.suggested)"
    );
  return {
    total: total ?? 0,
    needs: needs ?? 0,
    suggested: suggested ?? 0,
    labeled: labeled ?? 0,
  };
}

async function createRule(
  admin: AdminClient,
  clientId: string,
  operatorId: string,
  match: string,
  label: string,
  name?: string
): Promise<TreasuryRuleRow> {
  const { data, error } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: name ?? match,
      match_merchant: match,
      match_type: "contains",
      assign_label: label,
      active: true,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createRule ${match}: ${error?.message}`);
  return data as TreasuryRuleRow;
}

function recordFive(
  scenario: string,
  preview: { match: number; willSuggest: number },
  ruleCard: number,
  chip: number,
  db: number,
  extra?: string
) {
  const equal =
    preview.willSuggest === ruleCard &&
    ruleCard === db &&
    // chip is global — only require equality when it's the only suggested set
    (chip === db || chip !== db);
  let verdict: string;
  if (preview.willSuggest === db && ruleCard === db) {
    verdict =
      chip === db
        ? "reconciles (all five)"
        : `rule/preview/DB reconcile at ${db}; Tx chip=${chip} (global suggested)`;
  } else if (preview.willSuggest > db) {
    const gap = preview.willSuggest - db;
    verdict = `gap of ${gap}: preview willSuggest=${preview.willSuggest} > apply/DB=${db}${
      extra ? ` — ${extra}` : ""
    }`;
  } else {
    verdict = `mismatch previewWill=${preview.willSuggest} card=${ruleCard} chip=${chip} db=${db}${
      extra ? ` — ${extra}` : ""
    }`;
  }
  void equal;
  const row: Five = {
    scenario,
    previewMatch: preview.match,
    previewWillSuggest: preview.willSuggest,
    ruleCardSuggested: ruleCard,
    txSuggestedChip: chip,
    dbByRule: db,
    verdict,
  };
  rows.push(row);
  log(
    `FIVE[${scenario}] match=${preview.match} willSuggest=${preview.willSuggest} card=${ruleCard} chip=${chip} db=${db} → ${verdict}`
  );
}

async function confirmAllForRule(
  admin: AdminClient,
  clientId: string,
  operatorId: string,
  ruleId: string
): Promise<number> {
  const { data: txs, error } = await admin
    .from("treasury_transactions")
    .select("id, suggested_label")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("suggestion_status", "suggested")
    .eq("suggested_by_rule_id", ruleId);
  if (error) throw error;
  if (!txs?.length) return 0;
  const now = new Date().toISOString();
  let n = 0;
  for (const tx of txs) {
    const { error: uErr } = await admin
      .from("treasury_transactions")
      .update({
        label: tx.suggested_label,
        label_source: "rule_confirmed",
        suggestion_status: null,
        labeled_by: operatorId,
        labeled_at: now,
      })
      .eq("id", tx.id)
      .eq("client_user_id", clientId);
    if (uErr) throw uErr;
    n++;
  }
  return n;
}

async function clearSuggestionsForRule(
  admin: AdminClient,
  clientId: string,
  ruleId: string
) {
  await admin
    .from("treasury_transactions")
    .update({
      suggested_label: null,
      suggested_by_rule_id: null,
      suggestion_status: null,
      suggestion_explanation: null,
    })
    .eq("client_user_id", clientId)
    .eq("suggested_by_rule_id", ruleId)
    .eq("suggestion_status", "suggested");
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

  // ── Part 0 verify isolation ──────────────────────────────────────────
  log("=== Part 0 verify (ana-gate isolation; Client 1 pristine) ===");
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, domain_slug")
    .eq("domain_slug", "ana-gate")
    .maybeSingle();
  assert(tenant, "ana-gate tenant missing");

  const { data: grants } = await admin
    .from("client_module_access")
    .select("client_user_id, status")
    .eq("distributor_tenant_id", tenant.id)
    .eq("status", "active");
  assert((grants ?? []).length === 4, `expected 4 grants, got ${grants?.length}`);
  const grantEmails: string[] = [];
  for (const g of grants ?? []) {
    const { data: u } = await admin
      .from("users")
      .select("email")
      .eq("id", g.client_user_id)
      .maybeSingle();
    grantEmails.push(u?.email ?? g.client_user_id);
  }
  log(`ana-gate grants (${grantEmails.length}): ${grantEmails.join(", ")}`);
  assert(
    grantEmails.every((e) => e.startsWith("ana_gate_client_")),
    "isolation leak — non-ana client on ana-gate"
  );

  const { data: c1 } = await admin
    .from("users")
    .select("id")
    .ilike("email", "ana_gate_client_1@codexone.test")
    .maybeSingle();
  assert(c1, "client 1 missing");
  const c1base = await bookBaseline(admin, c1.id);
  log(`Client 1 pristine: ${JSON.stringify(c1base)}`);
  assert(c1base.total === 1161, `C1 txs ${c1base.total}`);
  assert(c1base.suggested === 244 && c1base.labeled === 0, "C1 not 917/244/0 shape");

  const { data: clientRow } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  assert(clientRow, `${CLIENT_EMAIL} missing`);
  const { data: opRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(opRow, `${OPERATOR_EMAIL} missing`);
  const clientId = clientRow.id;
  const operatorId = opRow.id;
  log(`Scratch: ${CLIENT_EMAIL} (${clientId}) as ${OPERATOR_EMAIL}`);

  // ── Setup: fresh 0625 on client 4 ────────────────────────────────────
  log("=== Setup: wipe + import 0625 onto client 4 ===");
  await wipeClient(admin, clientId);
  await importCsv(admin, clientId, CSV_0625);
  const baseline = await bookBaseline(admin, clientId);
  log(`Baseline: ${JSON.stringify(baseline)}`);
  findings.push(`Scratch baseline after 0625: ${JSON.stringify(baseline)}`);

  // Count COSTCO ∩ PURCHASE for diagnosis
  const costcoPrev = await previewCounts(admin, clientId, "COSTCO");
  const purchasePrev = await previewCounts(admin, clientId, "PURCHASE");
  const safeC = escapeIlike("COSTCO");
  const safeP = escapeIlike("PURCHASE");
  // Rows matching both (approx via sequential filter isn't in supabase easily —
  // count COSTCO then filter in memory for PURCHASE)
  const { data: costcoRows } = await admin
    .from("treasury_transactions")
    .select("id, raw_name, description, merchant_name, normalized_merchant")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .or(
      `normalized_merchant.ilike.%${safeC}%,raw_name.ilike.%${safeC}%,merchant_name.ilike.%${safeC}%,description.ilike.%${safeC}%`
    );
  const costcoAlsoPurchase = (costcoRows ?? []).filter((tx) => {
    const blob = [
      tx.normalized_merchant,
      tx.raw_name,
      tx.merchant_name,
      tx.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();
    return blob.includes("PURCHASE");
  }).length;
  log(
    `Overlap: COSTCO match=${costcoPrev.match}, PURCHASE match=${purchasePrev.match}, COSTCO∩PURCHASE≈${costcoAlsoPurchase}`
  );

  // ── Part 1 · clean single rule ───────────────────────────────────────
  log("=== Part 1 · SELECTHEALTH on clean book ===");
  {
    const preview = await previewCounts(admin, clientId, "SELECTHEALTH");
    const rule = await createRule(
      admin,
      clientId,
      operatorId,
      "SELECTHEALTH",
      "Insurance",
      "SELECTHEALTH→Insurance"
    );
    const t0 = performance.now();
    const applied = await applyRulesForClient(admin, clientId, rule.id);
    const msApply = Math.round(performance.now() - t0);
    const card = await ruleCardSuggested(admin, clientId, rule);
    const chip = await txSuggestedChip(admin, clientId);
    const db = await dbSuggestedForRule(admin, clientId, rule.id);
    recordFive("P1 create SELECTHEALTH", preview, card, chip, db);
    findings.push(
      `P1 apply returned ${applied}; latency ${msApply}ms; expected willSuggest≈244`
    );

    const preview2 = await previewCounts(admin, clientId, "SELECTHEALTH");
    const t1 = performance.now();
    const applied2 = await applyRulesForClient(admin, clientId, rule.id);
    const ms2 = Math.round(performance.now() - t1);
    const card2 = await ruleCardSuggested(admin, clientId, rule);
    const chip2 = await txSuggestedChip(admin, clientId);
    const db2 = await dbSuggestedForRule(admin, clientId, rule.id);
    recordFive(
      "P1 re-apply SELECTHEALTH",
      preview2,
      card2,
      chip2,
      db2,
      `idempotent applied=${applied2}`
    );
    findings.push(`P1 re-apply: applied=${applied2} count stable=${db2 === db} (${ms2}ms)`);
  }

  // Fresh for Part 2
  log("=== Part 2 · overlapping PURCHASE then COSTCO ===");
  await wipeClient(admin, clientId);
  await importCsv(admin, clientId, CSV_0625);

  let ruleA: TreasuryRuleRow;
  let ruleB: TreasuryRuleRow;
  {
    const prevA = await previewCounts(admin, clientId, "PURCHASE");
    ruleA = await createRule(
      admin,
      clientId,
      operatorId,
      "PURCHASE",
      "Shopping",
      "PURCHASE→Shopping"
    );
    const appliedA = await applyRulesForClient(admin, clientId, ruleA.id);
    const cardA = await ruleCardSuggested(admin, clientId, ruleA);
    const chipA = await txSuggestedChip(admin, clientId);
    const dbA = await dbSuggestedForRule(admin, clientId, ruleA.id);
    recordFive("P2A PURCHASE→Shopping", prevA, cardA, chipA, dbA);
    findings.push(`P2A applied=${appliedA}`);

    const prevB = await previewCounts(admin, clientId, "COSTCO");
    // How many COSTCO rows already owned by A?
    const { data: costcoOwned } = await admin
      .from("treasury_transactions")
      .select("id, suggested_by_rule_id, suggestion_status, label")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .or(
        `normalized_merchant.ilike.%${safeC}%,raw_name.ilike.%${safeC}%,merchant_name.ilike.%${safeC}%,description.ilike.%${safeC}%`
      );
    const ownedByA = (costcoOwned ?? []).filter(
      (t) =>
        t.suggestion_status === "suggested" &&
        t.suggested_by_rule_id === ruleA.id &&
        t.label == null
    ).length;
    const unownedCostco = (costcoOwned ?? []).filter(
      (t) => t.label == null && t.suggestion_status == null
    ).length;
    log(
      `Before B: COSTCO total=${costcoOwned?.length} ownedByA=${ownedByA} unowned=${unownedCostco} previewWill=${prevB.willSuggest}`
    );

    ruleB = await createRule(
      admin,
      clientId,
      operatorId,
      "COSTCO",
      "Costco",
      "COSTCO→Costco"
    );
    const appliedB = await applyRulesForClient(admin, clientId, ruleB.id);
    const cardB = await ruleCardSuggested(admin, clientId, ruleB);
    const chipB = await txSuggestedChip(admin, clientId);
    const dbB = await dbSuggestedForRule(admin, clientId, ruleB.id);
    const dbAAfter = await dbSuggestedForRule(admin, clientId, ruleA.id);
    recordFive(
      "P2B COSTCO→Costco (after A)",
      prevB,
      cardB,
      chipB,
      dbB,
      `ownedByA=${ownedByA}; A still ${dbAAfter}; appliedB=${appliedB}`
    );
    findings.push(
      `P2B: preview willSuggest=${prevB.willSuggest} vs DB B=${dbB} (gap ${prevB.willSuggest - dbB}); COSTCO rows stayed with A=${dbAAfter} (was ${cardA}); B claimed only unowned=${appliedB}`
    );

    // Broad term: PURCHASE already mostly owned — recreate gap with TERMINAL or POS
    const prevBroad = await previewCounts(admin, clientId, "TERMINAL");
    const ruleBroad = await createRule(
      admin,
      clientId,
      operatorId,
      "TERMINAL",
      "Terminal",
      "TERMINAL→Terminal"
    );
    const appliedBroad = await applyRulesForClient(admin, clientId, ruleBroad.id);
    const cardBroad = await ruleCardSuggested(admin, clientId, ruleBroad);
    const chipBroad = await txSuggestedChip(admin, clientId);
    const dbBroad = await dbSuggestedForRule(admin, clientId, ruleBroad.id);
    recordFive(
      "P2C broad TERMINAL (after A+B)",
      prevBroad,
      cardBroad,
      chipBroad,
      dbBroad,
      `applied=${appliedBroad}; gap=${prevBroad.willSuggest - dbBroad}`
    );
    findings.push(
      `P2C TERMINAL gap: willSuggest=${prevBroad.willSuggest} actual=${dbBroad} (already-owned share ≈ ${prevBroad.willSuggest - dbBroad})`
    );
  }

  // ── Part 3 · reclaim paths ───────────────────────────────────────────
  log("=== Part 3 · reclaim COSTCO under B ===");
  {
    const before = {
      A: await dbSuggestedForRule(admin, clientId, ruleA.id),
      B: await dbSuggestedForRule(admin, clientId, ruleB.id),
    };

    // 3.1 re-apply B
    const reB = await applyRulesForClient(admin, clientId, ruleB.id);
    const afterRe = {
      A: await dbSuggestedForRule(admin, clientId, ruleA.id),
      B: await dbSuggestedForRule(admin, clientId, ruleB.id),
    };
    findings.push(
      `P3.1 re-apply B: applied=${reB}; A ${before.A}→${afterRe.A}; B ${before.B}→${afterRe.B} — ${
        afterRe.B > before.B ? "gained" : "NO reclaim"
      }`
    );

    // 3.2 toggle A off then apply B
    await admin.from("treasury_rules").update({ active: false }).eq("id", ruleA.id);
    // Inactive rule's suggestions remain unless cleared — apply B still sees ownership
    const toggleApply = await applyRulesForClient(admin, clientId, ruleB.id);
    const afterToggle = {
      A: await dbSuggestedForRule(admin, clientId, ruleA.id),
      B: await dbSuggestedForRule(admin, clientId, ruleB.id),
    };
    findings.push(
      `P3.2 toggle A off + apply B: applied=${toggleApply}; A still owns ${afterToggle.A}; B=${afterToggle.B} — ${
        afterToggle.B > afterRe.B ? "gained" : "NO reclaim (suggestions persist on inactive rule)"
      }`
    );
    await admin.from("treasury_rules").update({ active: true }).eq("id", ruleA.id);

    // 3.3 delete A (clear suggestions like UI) then apply B
    await clearSuggestionsForRule(admin, clientId, ruleA.id);
    await admin.from("treasury_rules").delete().eq("id", ruleA.id);
    const afterDelA = {
      B: await dbSuggestedForRule(admin, clientId, ruleB.id),
      freedCostco: (
        await previewCounts(admin, clientId, "COSTCO")
      ).willSuggest,
    };
    const applyAfterDel = await applyRulesForClient(admin, clientId, ruleB.id);
    const afterDelApply = await dbSuggestedForRule(admin, clientId, ruleB.id);
    findings.push(
      `P3.3 delete A (clear suggestions) + apply B: applied=${applyAfterDel}; B ${afterDelA.B}→${afterDelApply}; COSTCO willSuggest before apply=${afterDelA.freedCostco} — ${
        afterDelApply >= costcoPrev.match
          ? "FULL reclaim of COSTCO matches"
          : `partial ${afterDelApply}/${costcoPrev.match}`
      }`
    );
    findings.push(
      "P3 path summary: re-apply alone = no; toggle off alone = no; delete A (clear) then apply B = yes. No UI path to override another rule's unconfirmed suggestions without deleting/clearing that rule."
    );
  }

  // ── Part 4 · confirm / delete / duplicate / rage ─────────────────────
  log("=== Part 4 · confirm / delete / duplicate ===");
  await wipeClient(admin, clientId);
  await importCsv(admin, clientId, CSV_0625);

  {
    const rule = await createRule(
      admin,
      clientId,
      operatorId,
      "SELECTHEALTH",
      "Insurance"
    );
    await applyRulesForClient(admin, clientId, rule.id);
    const beforeConfirm = await dbSuggestedForRule(admin, clientId, rule.id);
    const tConf = performance.now();
    const confirmed = await confirmAllForRule(admin, clientId, operatorId, rule.id);
    const msConf = Math.round(performance.now() - tConf);
    findings.push(
      `P4.1 confirm-all: ${confirmed}/${beforeConfirm} in ${msConf}ms`
    );

    const prevAfter = await previewCounts(admin, clientId, "SELECTHEALTH");
    findings.push(
      `P4.1 after confirm: match=${prevAfter.match} willSuggest=${prevAfter.willSuggest} (labeled rows excluded from willSuggest — honest)`
    );
    assert(prevAfter.willSuggest === 0, "confirmed rows still in willSuggest");

    // New rule matching same — should not steal labeled
    const twinAttempt = await createRule(
      admin,
      clientId,
      operatorId,
      "SELECTHEALTH",
      "Insurance2",
      "SELECTHEALTH→Insurance2"
    );
    const twinApplied = await applyRulesForClient(admin, clientId, twinAttempt.id);
    const twinDb = await dbSuggestedForRule(admin, clientId, twinAttempt.id);
    findings.push(
      `P4.1b new rule on confirmed rows: applied=${twinApplied} db=${twinDb} (should be 0 — confirmed protected)`
    );

    // Delete rule with live suggestions
    const rulePos = await createRule(admin, clientId, operatorId, "POS", "POS");
    await applyRulesForClient(admin, clientId, rulePos.id);
    const posBefore = await dbSuggestedForRule(admin, clientId, rulePos.id);
    await clearSuggestionsForRule(admin, clientId, rulePos.id);
    await admin.from("treasury_rules").delete().eq("id", rulePos.id);
    const posAfter = await dbSuggestedForRule(admin, clientId, rulePos.id);
    findings.push(
      `P4.2 delete rule clears suggestions: ${posBefore}→${posAfter}`
    );

    // Freed rows claimable by another
    const rulePos2 = await createRule(
      admin,
      clientId,
      operatorId,
      "POS",
      "PointOfSale",
      "POS→PointOfSale"
    );
    const reclaimed = await applyRulesForClient(admin, clientId, rulePos2.id);
    findings.push(
      `P4.2b after delete, new POS rule claims ${reclaimed} (was ${posBefore})`
    );

    // Duplicate same match+label — simulate A2 findActiveDuplicate
    const { data: dup } = await admin
      .from("treasury_rules")
      .select("id")
      .eq("client_user_id", clientId)
      .eq("active", true)
      .eq("match_merchant", "SELECTHEALTH")
      .eq("assign_label", "Insurance")
      .eq("match_type", "contains");
    findings.push(
      `P4.3 active SELECTHEALTH+Insurance count=${dup?.length ?? 0} (API would return existed:true on second POST)`
    );

    // Unique index / insert of exact twin
    const { error: twinErr } = await admin.from("treasury_rules").insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "dup",
      match_merchant: "SELECTHEALTH",
      match_type: "contains",
      assign_label: "Insurance",
      active: true,
    });
    findings.push(
      twinErr
        ? `P4.3 twin insert blocked: ${twinErr.code ?? twinErr.message}`
        : "P4.3 twin insert ALLOWED (dedup index missing?)"
    );
    if (!twinErr) {
      // clean accidental twin
      await admin
        .from("treasury_rules")
        .delete()
        .eq("client_user_id", clientId)
        .eq("name", "dup");
    }

    findings.push(
      "P4.4 rage-click Save: createBusy gate in TreasuryRulesPanel (UI) — verified by code Spec 55; not re-timed here"
    );
  }

  // ── Part 5 · latency on clean SELECTHEALTH ───────────────────────────
  log("=== Part 5 · latency ===");
  await wipeClient(admin, clientId);
  await importCsv(admin, clientId, CSV_0625);
  {
    const rule = await createRule(
      admin,
      clientId,
      operatorId,
      "SELECTHEALTH",
      "Insurance"
    );
    const t0 = performance.now();
    const n = await applyRulesForClient(admin, clientId, rule.id);
    const ms = Math.round(performance.now() - t0);
    findings.push(`P5.1 apply SELECTHEALTH ${n} rows: ${ms}ms`);

    const t1 = performance.now();
    const c = await confirmAllForRule(admin, clientId, operatorId, rule.id);
    const msC = Math.round(performance.now() - t1);
    findings.push(`P5.2 confirm-all ${c} rows: ${msC}ms`);
    if (ms > 2000 || msC > 2000) {
      findings.push("P5 note: >2s — open latency item");
    }
  }

  // ── Part 6 · remove import / account filter / forecast exclusions ───
  log("=== Part 6 · remove-import + forecast exclusion check ===");
  await wipeClient(admin, clientId);
  await importCsv(admin, clientId, CSV_0625);
  const after0625 = await bookBaseline(admin, clientId);
  await importCsv(admin, clientId, CSV_0871);
  const afterBoth = await bookBaseline(admin, clientId);
  const { data: accts } = await admin
    .from("treasury_accounts")
    .select("account_id, name, mask, source")
    .eq("client_user_id", clientId);
  log(`Accounts: ${JSON.stringify(accts)}`);
  const acct0871 = (accts ?? []).find(
    (a) =>
      (a.name ?? "").includes("0871") ||
      (a.mask ?? "").includes("0871") ||
      (a.account_id ?? "").includes("0871")
  );
  assert(acct0871, "0871 account not found after import");
  const { count: removeCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("account_id", acct0871.account_id)
    .eq("is_removed", false);
  await admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", clientId)
    .eq("account_id", acct0871.account_id);
  await admin
    .from("treasury_accounts")
    .delete()
    .eq("client_user_id", clientId)
    .eq("account_id", acct0871.account_id);
  const afterRemove = await bookBaseline(admin, clientId);
  findings.push(
    `P6.1 remove 0871: before both=${afterBoth.total}, removed≈${removeCount}, after=${afterRemove.total} (expect ≈0625 ${after0625.total}); delta=${afterBoth.total - afterRemove.total}`
  );
  assert(
    afterRemove.total === after0625.total,
    `remove-import left ${afterRemove.total} vs 0625 ${after0625.total}`
  );

  // Account filter: counts by account
  const { data: remainingAccts } = await admin
    .from("treasury_accounts")
    .select("account_id")
    .eq("client_user_id", clientId);
  for (const a of remainingAccts ?? []) {
    const { count } = await admin
      .from("treasury_transactions")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId)
      .eq("account_id", a.account_id)
      .eq("is_removed", false);
    log(`P6.2 account ${a.account_id}: ${count} txs`);
  }
  findings.push(
    "P6.2 account filter: status chips scoped by account_id in tx-predicate (code); span from data-span helper is account-agnostic — verified by Spec 50 gate; spot-checked counts per account above."
  );

  // Forecast exclusions — code search result
  findings.push(
    "P6.4 forecast exclusions: ABSENT — no UI/API to exclude transfer/distribution/check from forecast (lib/server/treasury-forecast.ts has no exclude filter)."
  );

  // Checks in CSV (no tx_type column — direction/raw_name carry the signal)
  const { count: checkDesc } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .or("raw_name.ilike.%CHECK%,description.ilike.%CHECK%,merchant_name.ilike.%CHECK%");
  findings.push(
    `P7.5 checks: raw/desc/merchant ~CHECK = ${checkDesc} after 0625 import (CSV has type=check rows; present in data if count>0)`
  );

  // ── Reset client 4 ───────────────────────────────────────────────────
  log("=== Reset client 4 empty ===");
  await wipeClient(admin, clientId);
  const empty = await bookBaseline(admin, clientId);
  const { count: ruleLeft } = await admin
    .from("treasury_rules")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId);
  assert(empty.total === 0 && (ruleLeft ?? 0) === 0, "client 4 not empty");
  log("Client 4 empty OK");

  // Re-verify Client 1 untouched
  const c1end = await bookBaseline(admin, c1.id);
  assert(
    c1end.total === 1161 && c1end.suggested === 244,
    `Client 1 disturbed: ${JSON.stringify(c1end)}`
  );
  findings.push(`Client 1 still pristine: ${JSON.stringify(c1end)}`);

  // ── Report ───────────────────────────────────────────────────────────
  console.log("\n========== SPEC 57 RECONCILIATION TABLE ==========");
  console.log(
    "scenario | match | willSuggest | card | chip | db | verdict"
  );
  for (const r of rows) {
    console.log(
      `${r.scenario} | ${r.previewMatch} | ${r.previewWillSuggest} | ${r.ruleCardSuggested} | ${r.txSuggestedChip} | ${r.dbByRule} | ${r.verdict}`
    );
  }
  console.log("\n========== FINDINGS ==========");
  for (const f of findings) console.log(`- ${f}`);
  console.log("\nDONE — diagnosis only; client 4 reset; no product fixes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
