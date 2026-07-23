/**
 * Spec 61 gate — rule queue triage facets on ana_gate_client_4.
 * Usage: npx tsx scripts/gate-spec61-rule-queue-facets.ts
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
    /* */
  }
}

function log(msg: string) {
  console.log(`[gate61] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function wipe(admin: AdminClient, clientId: string) {
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

type Facets = {
  combos: Array<{ labels: string[]; count: number }>;
  confirmed: number;
  rejected: number;
};

async function facets(
  admin: AdminClient,
  clientId: string,
  ruleId: string
): Promise<Facets> {
  const t0 = performance.now();
  const { data, error } = await admin.rpc("treasury_rule_queue_facets", {
    p_client: clientId,
    p_rule: ruleId,
  });
  const ms = Math.round(performance.now() - t0);
  if (error) throw error;
  return { ...(data as Facets), _ms: ms } as Facets & { _ms?: number };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin: AdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: clientRow } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  assert(clientRow, "client missing");
  const { data: op } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(op, "operator missing");
  const clientId = clientRow.id;
  const operatorId = op.id;

  await wipe(admin, clientId);
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
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
      assign_label: "SelectHealth",
      active: true,
    })
    .select("*")
    .single();
  const { data: hcc } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "HCCLAIMPMT",
      match_merchant: "HCCLAIMPMT",
      match_type: "contains",
      assign_label: "HCCClaim",
      active: true,
    })
    .select("*")
    .single();
  assert(sh && hcc, "rules");

  await applyRulesForClient(admin, clientId, sh.id);
  await applyRulesForClient(admin, clientId, hcc.id);

  const tFacet0 = performance.now();
  const { data: fRaw, error: fErr } = await admin.rpc("treasury_rule_queue_facets", {
    p_client: clientId,
    p_rule: sh.id,
  });
  const facetMs = Math.round(performance.now() - tFacet0);
  assert(!fErr, fErr?.message ?? "facets");
  const f = fRaw as Facets;
  log(
    `1 SELECTHEALTH facets: combos=${JSON.stringify(f.combos)} confirmed=${f.confirmed} rejected=${f.rejected} (${facetMs}ms)`
  );

  const comboSum = f.combos.reduce((a, c) => a + c.count, 0);
  const { count: shSug } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", sh.id);
  assert(comboSum === (shSug ?? 0), `combo sum ${comboSum} ≠ suggested ${shSug}`);
  assert((shSug ?? 0) === 244, `SELECTHEALTH suggested ${shSug}`);

  const overlap = f.combos.find(
    (c) =>
      c.labels.includes("SelectHealth") && c.labels.includes("HCCClaim")
  );
  assert(overlap && overlap.count === 244, `overlap bucket ${JSON.stringify(overlap)}`);

  // Combo page lists
  const { data: pageJson } = await admin.rpc("treasury_rule_queue_combo_page", {
    p_client: clientId,
    p_rule: sh.id,
    p_combo: overlap!.labels,
    p_offset: 0,
    p_limit: 50,
  });
  const page = pageJson as { total: number; ids: string[] };
  assert(page.total === 244, `combo page total ${page.total}`);
  assert(page.ids.length === 50, `combo page ids ${page.ids.length}`);
  log(`2 Combo page: total=${page.total} page0=${page.ids.length}`);

  // Bulk confirm bucket
  const { data: confJson, error: confErr } = await admin.rpc(
    "treasury_rule_queue_combo_confirm",
    {
      p_client: clientId,
      p_rule: sh.id,
      p_combo: overlap!.labels,
      p_actor: operatorId,
    }
  );
  assert(!confErr, confErr?.message ?? "confirm");
  const confirmed = (confJson as { confirmed: number }).confirmed;
  assert(confirmed === 244, `confirmed ${confirmed}`);

  const { data: f2 } = await admin.rpc("treasury_rule_queue_facets", {
    p_client: clientId,
    p_rule: sh.id,
  });
  const facetsAfter = f2 as Facets;
  assert(facetsAfter.confirmed === 244, `SH confirmed ${facetsAfter.confirmed}`);
  assert(
    facetsAfter.combos.reduce((a, c) => a + c.count, 0) === 0,
    "SH combos should be empty"
  );

  const { count: hccLeft } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", hcc.id);
  assert(
    (hccLeft ?? 0) === 546 - 244,
    `HCCLAIMPMT should drop by 244 → ${546 - 244}, got ${hccLeft}`
  );
  log(
    `3 Bulk-confirm: SH confirmed=244; HCCLAIMPMT left=${hccLeft} (was 546)`
  );

  // Confirmed bucket filterable via combo_page? use list of confirmed via predicate
  const { count: confList } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("suggested_by_rule_id", sh.id)
    .eq("label_source", "rule_confirmed");
  assert(confList === 244, "confirmed filterable");

  // Reject smoke
  const { data: hccPage } = await admin.rpc("treasury_rule_queue_combo_page", {
    p_client: clientId,
    p_rule: hcc.id,
    p_combo: ["HCCClaim"],
    p_offset: 0,
    p_limit: 1,
  });
  const rejectId = (hccPage as { ids: string[] }).ids[0];
  assert(rejectId, "need hcc-only tx");
  await admin.from("treasury_rule_rejections").upsert({
    transaction_id: rejectId,
    rule_id: hcc.id,
    rejected_by: operatorId,
  });
  await admin
    .from("treasury_transaction_suggestions")
    .delete()
    .eq("transaction_id", rejectId)
    .eq("rule_id", hcc.id);
  const { data: fH } = await admin.rpc("treasury_rule_queue_facets", {
    p_client: clientId,
    p_rule: hcc.id,
  });
  assert((fH as Facets).rejected === 1, "rejected facet");
  log(`4 Rejected facet=1; confirmed bucket ok`);

  // Latency on remaining HCC (~302)
  const tH = performance.now();
  await admin.rpc("treasury_rule_queue_facets", {
    p_client: clientId,
    p_rule: hcc.id,
  });
  const hccFacetMs = Math.round(performance.now() - tH);
  log(`5 HCCLAIMPMT facet refetch ${hccFacetMs}ms (post-overlap book)`);

  // Drift check quick
  const { count: flagTrue } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("has_pending_suggestion", true);
  const { data: sugTx } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id")
    .eq("client_user_id", clientId);
  const uniqueSug = new Set((sugTx ?? []).map((s) => s.transaction_id)).size;
  assert(flagTrue === uniqueSug, `drift flag=${flagTrue} exists=${uniqueSug}`);

  await wipe(admin, clientId);
  console.log("\n=== Spec 61 PASS ===");
  console.log({
    facet_sum_equals_suggested: true,
    overlap_bucket: 244,
    bulk_confirm: 244,
    hcc_after: hccLeft,
    facet_ms_selecthealth: facetMs,
    facet_ms_hcc_remaining: hccFacetMs,
    rejected: 1,
    drift_ok: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
