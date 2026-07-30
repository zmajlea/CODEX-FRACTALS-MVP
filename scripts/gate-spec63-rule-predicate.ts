/**
 * Spec 63 gate — shared rule predicate + two-step band on ana_gate_client_4.
 * Usage: npx tsx scripts/gate-spec63-rule-predicate.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";
import {
  applyRulesForClient,
  reconcileRuleSuggestions,
} from "../lib/treasury/apply-rules-for-client";
import {
  countRuleMatches,
  fetchRulePayeeStats,
  formatRuleConstraintSummary,
} from "../lib/treasury/rule-predicate";
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
    /* */
  }
}

function log(msg: string) {
  console.log(`[gate63] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function wipe(admin: AdminClient, clientId: string) {
  const { data: rules } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientId);
  const ruleIds = (rules ?? []).map((r) => r.id);
  if (ruleIds.length > 0) {
    const { error: sugErr } = await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .in("rule_id", ruleIds);
    if (sugErr) throw new Error(`wipe suggestions: ${sugErr.message}`);
  }
  const { error: txErr } = await admin
    .from("treasury_transactions")
    .delete()
    .eq("client_user_id", clientId);
  if (txErr) throw new Error(`wipe txs: ${txErr.message}`);
  const { error: ruleErr } = await admin
    .from("treasury_rules")
    .delete()
    .eq("client_user_id", clientId);
  if (ruleErr) throw new Error(`wipe rules: ${ruleErr.message}`);
  const { error: acctErr } = await admin
    .from("treasury_accounts")
    .delete()
    .eq("client_user_id", clientId);
  if (acctErr) throw new Error(`wipe accounts: ${acctErr.message}`);
}

async function createRule(
  admin: AdminClient,
  clientId: string,
  operatorId: string,
  match: string,
  label: string,
  extra?: Partial<TreasuryRuleRow>
): Promise<TreasuryRuleRow> {
  const { data, error } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: `Rule: ${label}`,
      match_merchant: match,
      match_type: extra?.match_type ?? "contains",
      assign_label: label,
      amount_min: extra?.amount_min ?? null,
      amount_max: extra?.amount_max ?? null,
      direction: extra?.direction ?? null,
      date_from: extra?.date_from ?? null,
      date_to: extra?.date_to ?? null,
      source_transaction_id: extra?.source_transaction_id ?? null,
      active: true,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createRule failed");
  return data as TreasuryRuleRow;
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
  assert(clientRow, "ana_gate_client_4 missing");
  const { data: op } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(op, "ana_gate_operator missing");
  const clientId = clientRow.id;
  const operatorId = op.id;

  log("wipe + import 0625");
  await wipe(admin, clientId);
  const csv = readFileSync(join(ROOT, CSV_PATH), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  // 1. Predicate parity broad SELECTHEALTH
  const shPayee = "SELECTHEALTH";
  const previewBroad = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: shPayee, matchType: "contains" },
    { labelNullOnly: true }
  );
  const ruleSh = await createRule(admin, clientId, operatorId, shPayee, "Insurance");
  const appliedSh = await applyRulesForClient(admin, clientId, ruleSh.id);
  log(
    `1 parity SELECTHEALTH previewWill=${previewBroad} apply=${appliedSh} gap=${previewBroad - appliedSh}`
  );
  assert(previewBroad === appliedSh, "SELECTHEALTH preview!==apply");

  // HCCLAIMPMT scale
  const hccPreview = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "HCCLAIMPMT", matchType: "contains" },
    { labelNullOnly: true }
  );
  const t0 = performance.now();
  const ruleHcc = await createRule(
    admin,
    clientId,
    operatorId,
    "HCCLAIMPMT",
    "Claims"
  );
  const appliedHcc = await applyRulesForClient(admin, clientId, ruleHcc.id);
  const hccMs = Math.round(performance.now() - t0);
  log(
    `13 HCCLAIMPMT preview=${hccPreview} apply=${appliedHcc} gap=${hccPreview - appliedHcc} latency=${hccMs}ms`
  );
  assert(hccPreview === appliedHcc && hccPreview >= 500, "HCC scale parity");

  // 2. Stats accuracy
  const tStats = performance.now();
  const stats = await fetchRulePayeeStats(admin, clientId, "HCCLAIMPMT", {
    matchType: "contains",
  });
  const statsMs = Math.round(performance.now() - tStats);
  const monthSum = (stats.by_month ?? []).reduce((a, p) => a + p.count, 0);
  const weekSum = (stats.by_week ?? []).reduce((a, p) => a + p.count, 0);
  log(
    `2 stats total=${stats.total} will=${stats.will_suggest} monthSum=${monthSum} weekSum=${weekSum} ms=${statsMs} basis=${stats.points_per_period.basis}`
  );
  assert(stats.total === monthSum, "by_month sum !== total");
  assert(stats.total === weekSum, "by_week sum !== total");
  assert(stats.points_per_period.basis === "active", "points basis");
  assert(stats.min != null && stats.max != null && stats.min <= stats.max, "min/max");

  // Independent pass over sample page for mean sanity
  assert(
    stats.p25 != null &&
      stats.p75 != null &&
      Number(stats.p25) <= Number(stats.p75),
    "quartiles"
  );

  // 3. Preset tight band parity
  const tightMin = Number(stats.p25);
  const tightMax = Number(stats.p75);
  const willTight = await countRuleMatches(
    admin,
    clientId,
    {
      payeeQuery: "HCCLAIMPMT",
      matchType: "contains",
      amount_min: tightMin,
      amount_max: tightMax,
    },
    { labelNullOnly: true }
  );
  await admin
    .from("treasury_rules")
    .update({ amount_min: tightMin, amount_max: tightMax })
    .eq("id", ruleHcc.id);
  const { data: ruleHcc2 } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleHcc.id)
    .single();
  const recon = await reconcileRuleSuggestions(
    admin,
    clientId,
    ruleHcc2 as TreasuryRuleRow
  );
  const { count: sugAfterNarrow } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleHcc.id);
  log(
    `3 tight will=${willTight} reconcileUpserts=${recon} sugRows=${sugAfterNarrow} broadWas=${hccPreview}`
  );
  assert(willTight < hccPreview, "tight not narrower");
  assert(sugAfterNarrow === willTight, "orphan prune failed after narrow");

  // Typical between tight and all
  const mean = Number(stats.mean);
  const sd = Number(stats.stddev ?? 0);
  const typMin = Math.max(0, mean - sd);
  const typMax = mean + sd;
  const willTyp = await countRuleMatches(
    admin,
    clientId,
    {
      payeeQuery: "HCCLAIMPMT",
      matchType: "contains",
      amount_min: typMin,
      amount_max: typMax,
    },
    { labelNullOnly: true }
  );
  log(`3b typical will=${willTyp} (expect tight<=typ<=broad)`);
  assert(willTyp >= willTight && willTyp <= hccPreview, "typical between");

  // 4. Tim-shape make-rule: no band; source id
  const { data: sampleTx } = await admin
    .from("treasury_transactions")
    .select("id, amount, direction, label, normalized_merchant")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .eq("direction", "in")
    .gte("amount", -200)
    .lte("amount", -100)
    .limit(1)
    .maybeSingle();
  assert(sampleTx, "no ~$160 inflow sample");
  // Simulate make-rule payload (no amount band)
  const makePayload = {
    amount_min: null as number | null,
    amount_max: null as number | null,
    direction: sampleTx.direction as string,
    source_transaction_id: sampleTx.id as string,
  };
  const ruleTim = await createRule(
    admin,
    clientId,
    operatorId,
    "COSTCO",
    "Self Pay",
    makePayload
  );
  assert(ruleTim.amount_min == null && ruleTim.amount_max == null, "silent band");
  assert(ruleTim.source_transaction_id === sampleTx.id, "provenance");
  const squareWill = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COSTCO", matchType: "contains", direction: "in" },
    { labelNullOnly: true }
  );
  const appliedSq = await applyRulesForClient(admin, clientId, ruleTim.id);
  log(
    `4 Tim-shape no-band source=${ruleTim.source_transaction_id?.slice(0, 8)} will=${squareWill} apply=${appliedSq}`
  );
  assert(squareWill === appliedSq, "COSTCO parity");
  assert(squareWill > 0, "COSTCO should match some rows");

  // 7. Edge char escaping
  const edge = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "CLAIM_PMT", matchType: "contains" },
    { labelNullOnly: true }
  );
  log(`7 edge _ query count=${edge} (escape smoke)`);

  // 8. Fuzzy parity
  const fuzzyPrev = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "SELECTHEALTH", matchType: "fuzzy" },
    { labelNullOnly: true }
  );
  const ruleFz = await createRule(
    admin,
    clientId,
    operatorId,
    "SELECTHEALTH",
    "FuzzyIns",
    { match_type: "fuzzy" }
  );
  // clear prior SH suggestions conflict — different assign label so OK
  const appliedFz = await applyRulesForClient(admin, clientId, ruleFz.id);
  log(`8 fuzzy preview=${fuzzyPrev} apply=${appliedFz}`);
  assert(fuzzyPrev === appliedFz, "fuzzy parity");
  assert(fuzzyPrev > 0, "fuzzy should match SELECTHEALTH");

  // 9. Direction
  const inOnly = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COSTCO", matchType: "contains", direction: "in" },
    { labelNullOnly: false }
  );
  const outOnly = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COSTCO", matchType: "contains", direction: "out" },
    { labelNullOnly: false }
  );
  const allSq = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COSTCO", matchType: "contains" },
    { labelNullOnly: false }
  );
  log(`9 direction in=${inOnly} out=${outOnly} all=${allSq}`);
  assert(inOnly + outOnly === allSq, "direction partition");
  assert(allSq > 0, "COSTCO direction smoke");

  // 10. total vs will_suggest
  assert(stats.total >= stats.will_suggest, "total>=will");

  // 11. Edit widen — clear band on HCC
  await admin
    .from("treasury_rules")
    .update({ amount_min: null, amount_max: null })
    .eq("id", ruleHcc.id);
  const { data: ruleWide } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleHcc.id)
    .single();
  await reconcileRuleSuggestions(admin, clientId, ruleWide as TreasuryRuleRow);
  const { count: sugWide } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleHcc.id);
  log(`11 widen sug=${sugWide} expect≈${hccPreview}`);
  assert(sugWide === hccPreview, "widen restore");

  // 14. Trigger drift sample
  const { data: sample } = await admin
    .from("treasury_transactions")
    .select("id, has_pending_suggestion")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .limit(50);
  let drift = 0;
  for (const row of sample ?? []) {
    const { count } = await admin
      .from("treasury_transaction_suggestions")
      .select("transaction_id", { count: "exact", head: true })
      .eq("transaction_id", row.id);
    const exists = (count ?? 0) > 0;
    if (Boolean(row.has_pending_suggestion) !== exists) drift++;
  }
  log(`14 trigger-drift on 50 sample = ${drift}`);
  assert(drift === 0, "trigger drift");

  // ——— Spec 63 Part F ———
  // F6 date-scoped parity (COMCAST)
  const { data: comcastDates } = await admin
    .from("treasury_transactions")
    .select("posted_date")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .or(
      "normalized_merchant.ilike.%COMCAST%,merchant_name.ilike.%COMCAST%,raw_name.ilike.%COMCAST%,description.ilike.%COMCAST%"
    )
    .not("posted_date", "is", null)
    .order("posted_date", { ascending: true });
  const uniqueDates = [
    ...new Set(
      (comcastDates ?? []).map((r) => String(r.posted_date).slice(0, 10))
    ),
  ].sort();
  assert(uniqueDates.length >= 4, "need COMCAST history for date window");
  const mid = Math.floor(uniqueDates.length / 2);
  const dateFrom = uniqueDates[Math.max(0, mid - 1)]!;
  const dateTo = uniqueDates[Math.min(uniqueDates.length - 1, mid + 1)]!;
  assert(dateFrom <= dateTo, "window order");

  const comcastFull = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COMCAST", matchType: "contains" },
    { labelNullOnly: true }
  );
  const comcastWin = await countRuleMatches(
    admin,
    clientId,
    {
      payeeQuery: "COMCAST",
      matchType: "contains",
      date_from: dateFrom,
      date_to: dateTo,
    },
    { labelNullOnly: true }
  );
  const ruleCx = await createRule(
    admin,
    clientId,
    operatorId,
    "COMCAST",
    "Utilities",
    { date_from: dateFrom, date_to: dateTo }
  );
  const appliedCx = await applyRulesForClient(admin, clientId, ruleCx.id);
  log(
    `F6 date window ${dateFrom}→${dateTo} full=${comcastFull} win=${comcastWin} apply=${appliedCx}`
  );
  assert(comcastWin < comcastFull, "date window not narrower than full");
  assert(comcastWin === appliedCx, "date-scoped preview!==apply");
  assert(comcastWin > 0, "date window empty");

  // Review recompute: band + window → stats month/week sums === scoped total
  const reviewStats = await fetchRulePayeeStats(admin, clientId, "COMCAST", {
    matchType: "contains",
    date_from: dateFrom,
    date_to: dateTo,
  });
  const revMonth = (reviewStats.by_month ?? []).reduce((a, p) => a + p.count, 0);
  const revWeek = (reviewStats.by_week ?? []).reduce((a, p) => a + p.count, 0);
  log(
    `F6 review total=${reviewStats.total} will=${reviewStats.will_suggest} month=${revMonth} week=${revWeek}`
  );
  assert(reviewStats.total === revMonth, "review by_month !== total");
  assert(reviewStats.total === revWeek, "review by_week !== total");
  assert(
    reviewStats.will_suggest === comcastWin,
    "review will_suggest !== window will"
  );

  // Date reconcile: widen then narrow
  await admin
    .from("treasury_rules")
    .update({ date_from: null, date_to: null })
    .eq("id", ruleCx.id);
  const { data: ruleCxWide } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleCx.id)
    .single();
  await reconcileRuleSuggestions(
    admin,
    clientId,
    ruleCxWide as TreasuryRuleRow
  );
  const { count: sugCxWide } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleCx.id);
  log(`F6 widen sug=${sugCxWide} expect=${comcastFull}`);
  assert(sugCxWide === comcastFull, "date widen restore");

  await admin
    .from("treasury_rules")
    .update({ date_from: dateFrom, date_to: dateTo })
    .eq("id", ruleCx.id);
  const { data: ruleCxNarrow } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleCx.id)
    .single();
  await reconcileRuleSuggestions(
    admin,
    clientId,
    ruleCxNarrow as TreasuryRuleRow
  );
  const { count: sugCxNarrow } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleCx.id);
  log(`F6 narrow sug=${sugCxNarrow} expect=${comcastWin}`);
  assert(sugCxNarrow === comcastWin, "date narrow orphan prune");

  // Card + clear
  const cardWith = formatRuleConstraintSummary({
    date_from: dateFrom,
    date_to: dateTo,
  });
  assert(
    cardWith != null &&
      cardWith.includes(dateFrom) &&
      cardWith.includes(dateTo),
    "card missing date window"
  );
  const cardCleared = formatRuleConstraintSummary({
    date_from: null,
    date_to: null,
  });
  assert(cardCleared == null, "card clear should hide window");
  log(`F6 card="${cardWith}" cleared=${cardCleared == null}`);

  // Inverted range → empty, not error
  const inverted = await countRuleMatches(
    admin,
    clientId,
    {
      payeeQuery: "COMCAST",
      matchType: "contains",
      date_from: dateTo,
      date_to: dateFrom,
    },
    { labelNullOnly: false }
  );
  assert(dateFrom !== dateTo ? inverted === 0 : true, "inverted range empty");
  log(`F6 inverted count=${inverted}`);

  log("reset client 4");
  await wipe(admin, clientId);
  log("PASS Spec 63 (+ Part F)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
