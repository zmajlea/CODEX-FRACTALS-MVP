/**
 * Spec 64 gate — R1 polish parity checks on ana_gate_client_4.
 * Usage: npx tsx scripts/gate-spec64-r1-polish.ts
 *
 * Scripted: empty-band parity, Review band+date, live-list === will_suggest predicate,
 * Spec 63F date reconcile. Manual UI checks listed at end.
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
  fetchRuleMatchPage,
  fetchRulePayeeStats,
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
  console.log(`[gate64] ${msg}`);
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
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .in("rule_id", ruleIds);
  }
  await admin.from("treasury_transactions").delete().eq("client_user_id", clientId);
  await admin.from("treasury_rules").delete().eq("client_user_id", clientId);
  await admin.from("treasury_accounts").delete().eq("client_user_id", clientId);
}

async function main() {
  loadEnvLocal();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws as never },
    }
  ) as AdminClient;

  const { data: clientRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  const { data: op } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  assert(clientRow && op, "gate users missing");
  const clientId = clientRow.id;
  const operatorId = op.id;

  log("wipe + import 0625");
  await wipe(admin, clientId);
  const parsed = parseTreasuryCsv(
    readFileSync(join(ROOT, CSV_PATH), "utf8"),
    clientId
  );
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  // Source checks: presets gone; Δ present
  const popupSrc = readFileSync(
    join(ROOT, "components/operator/treasury/RuleAmountAnalyzePopup.tsx"),
    "utf8"
  );
  assert(!popupSrc.includes("Suggest all"), "Suggest all still in popup");
  assert(!/\bTypical\b/.test(popupSrc), "Typical preset still present");
  assert(!/\bTight\b/.test(popupSrc), "Tight preset still present");
  assert(popupSrc.includes("Δ "), "capital Δ missing from popup");
  assert(popupSrc.includes("busy-indeterminate"), "progress indicator missing");
  assert(popupSrc.includes("will be suggested"), "live will-suggest copy missing");
  log("1 UI source: presets gone, Δ present, progress + live list markup OK");

  // Empty-band parity on 500+ payee
  const willEmpty = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "HCCLAIMPMT", matchType: "contains" },
    { labelNullOnly: true }
  );
  assert(willEmpty >= 500, `HCC too small: ${willEmpty}`);
  const { data: ruleEmpty, error: e1 } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "Rule: Claims",
      match_merchant: "HCCLAIMPMT",
      match_type: "contains",
      assign_label: "Claims",
      amount_min: null,
      amount_max: null,
      active: true,
    })
    .select("*")
    .single();
  assert(!e1 && ruleEmpty, e1?.message ?? "rule insert");
  const appliedEmpty = await applyRulesForClient(admin, clientId, ruleEmpty.id);
  log(`2 empty-band will=${willEmpty} apply=${appliedEmpty}`);
  assert(willEmpty === appliedEmpty, "empty-band will_suggest !== apply");

  // Live list shares will_suggest predicate (labelNullOnly true)
  const page = await fetchRuleMatchPage(
    admin,
    clientId,
    { payeeQuery: "HCCLAIMPMT", matchType: "contains" },
    { labelNullOnly: true, offset: 0, limit: 50 }
  );
  assert(page.length <= willEmpty, "list longer than will_suggest");
  assert(page.length === Math.min(50, willEmpty), "list page size vs will_suggest");
  log(`3 live-list page=${page.length} of will=${willEmpty} (same predicate)`);

  // Review: band + date window
  const stats = await fetchRulePayeeStats(admin, clientId, "COMCAST", {
    matchType: "contains",
  });
  const { data: cxDates } = await admin
    .from("treasury_transactions")
    .select("posted_date")
    .eq("client_user_id", clientId)
    .eq("is_removed", false)
    .or(
      "normalized_merchant.ilike.%COMCAST%,merchant_name.ilike.%COMCAST%,raw_name.ilike.%COMCAST%,description.ilike.%COMCAST%"
    )
    .not("posted_date", "is", null)
    .order("posted_date", { ascending: true });
  const dates = [
    ...new Set(
      (cxDates ?? []).map((r) => String(r.posted_date).slice(0, 10))
    ),
  ].sort();
  assert(dates.length >= 4, "COMCAST history");
  const mid = Math.floor(dates.length / 2);
  const dateFrom = dates[Math.max(0, mid - 1)]!;
  const dateTo = dates[Math.min(dates.length - 1, mid + 1)]!;
  const bandMin = Number(stats.p25);
  const bandMax = Number(stats.p75);
  const willScoped = await countRuleMatches(
    admin,
    clientId,
    {
      payeeQuery: "COMCAST",
      matchType: "contains",
      amount_min: bandMin,
      amount_max: bandMax,
      date_from: dateFrom,
      date_to: dateTo,
    },
    { labelNullOnly: true }
  );
  const willBroad = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COMCAST", matchType: "contains" },
    { labelNullOnly: true }
  );
  const scopedStats = await fetchRulePayeeStats(admin, clientId, "COMCAST", {
    matchType: "contains",
    amount_min: bandMin,
    amount_max: bandMax,
    date_from: dateFrom,
    date_to: dateTo,
  });
  const monthSum = (scopedStats.by_month ?? []).reduce((a, p) => a + p.count, 0);
  log(
    `4 Review scoped will=${willScoped} broad=${willBroad} monthSum=${monthSum} statsTotal=${scopedStats.total}`
  );
  assert(willScoped < willBroad, "scoped not narrower");
  assert(monthSum === scopedStats.total, "Review month sum !== scoped total");

  // Empty band Review = broad
  const emptyStats = await fetchRulePayeeStats(admin, clientId, "COMCAST", {
    matchType: "contains",
  });
  assert(emptyStats.will_suggest === willBroad, "empty Review will !== broad");
  log(`5 empty-band Review will=${emptyStats.will_suggest} === broad`);

  // Spec 63F date reconcile regression
  const { data: ruleCx } = await admin
    .from("treasury_rules")
    .insert({
      client_user_id: clientId,
      created_by: operatorId,
      name: "Rule: Utilities",
      match_merchant: "COMCAST",
      match_type: "contains",
      assign_label: "Utilities",
      date_from: dateFrom,
      date_to: dateTo,
      active: true,
    })
    .select("*")
    .single();
  assert(ruleCx, "COMCAST rule");
  const winWill = await countRuleMatches(
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
  const appliedWin = await applyRulesForClient(admin, clientId, ruleCx.id);
  assert(winWill === appliedWin, "date window will!==apply");
  await admin
    .from("treasury_rules")
    .update({ date_from: null, date_to: null })
    .eq("id", ruleCx.id);
  const { data: wide } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleCx.id)
    .single();
  await reconcileRuleSuggestions(admin, clientId, wide as TreasuryRuleRow);
  const { count: sugWide } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleCx.id);
  assert(sugWide === willBroad, "date widen restore");
  await admin
    .from("treasury_rules")
    .update({ date_from: dateFrom, date_to: dateTo })
    .eq("id", ruleCx.id);
  const { data: narrow } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", ruleCx.id)
    .single();
  await reconcileRuleSuggestions(admin, clientId, narrow as TreasuryRuleRow);
  const { count: sugNarrow } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleCx.id);
  assert(sugNarrow === winWill, "date narrow prune");
  log(`6 Spec63F date reconcile win=${winWill} wide=${sugWide} narrow=${sugNarrow}`);

  // TxRow: + rule ungated
  const txRow = readFileSync(
    join(ROOT, "components/operator/treasury/TreasuryTxRow.tsx"),
    "utf8"
  );
  assert(!txRow.includes("isConfirmed && onMakeRule"), "+ rule still gated on confirmed");
  assert(txRow.includes("justCategorized"), "justCategorized prop missing");
  log("7 +rule ungated; justCategorized pin prop present");

  log("MANUAL: Δ in bars; progress on apply/Review/confirm-all; pin stays visible without changing Uncategorized/Suggested counts; live list updates on filter edit");
  log("FEEDBACK SWEEP: pulled A–G (Δ, presets, progress, Review, pin, +rule, live list). Deferred: forecast account filter detail, multi-category, delete-all rules, compose-in-drawer, re-enable New client, R2 analytics.");

  await wipe(admin, clientId);
  log("reset client 4");
  log("PASS Spec 64");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
