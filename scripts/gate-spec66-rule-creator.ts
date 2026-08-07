/**
 * Spec 66 gate — 3-column rule creator + period filter via RPC from/to.
 * Usage: npx tsx scripts/gate-spec66-rule-creator.ts
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
import { intersectDateRanges } from "../lib/treasury/period-bounds";
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
  console.log(`[gate66] ${msg}`);
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

  const panelSrc = readFileSync(
    join(ROOT, "components/operator/treasury/TreasuryRulesPanel.tsx"),
    "utf8"
  );
  const popupSrc = readFileSync(
    join(ROOT, "components/operator/treasury/RuleAmountAnalyzePopup.tsx"),
    "utf8"
  );
  const boundsSrc = readFileSync(
    join(ROOT, "lib/treasury/period-bounds.ts"),
    "utf8"
  );

  assert(panelSrc.includes("Create a rule manually"), "entry button missing");
  assert(!panelSrc.includes("Create a rule manually (advanced)"), "advanced label remains");
  assert(!panelSrc.includes("<details"), "inline details form remains");
  assert(!panelSrc.includes("Step 1 · Payee"), "inline Step 1 remains");
  assert(panelSrc.includes("explainer-actions"), "peer button row missing");
  log("1 entry: peer button, no inline Step 1");

  assert(popupSrc.includes("createPortal"), "portal backdrop missing");
  assert(popupSrc.includes('overflow = "hidden"'), "body scroll lock missing");
  assert(popupSrc.includes("rule-analyze-panel--3col"), "3-column panel missing");
  assert(popupSrc.includes("rule-analyze-cols"), "3-column grid missing");
  assert(!popupSrc.includes("σ "), "sigma label still present");
  assert(popupSrc.includes("· Δ"), "Δ deviation format missing");
  assert(popupSrc.includes("Show all"), "Show all control missing");
  assert(popupSrc.includes("Review"), "Review button removed");
  log("2 modal + 3-col source OK");

  assert(boundsSrc.includes("export function periodEnd"), "periodEnd clobbered");
  assert(boundsSrc.includes("intersectDateRanges"), "intersectDateRanges missing");
  assert(!boundsSrc.includes("weekPeriodToRange"), "client ISO-week parser added");
  log("3 period-bounds extended, not recreated");

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
  assert(willEmpty === appliedEmpty, "Spec63 will_suggest !== apply");
  log(`4 Spec63 parity will=${willEmpty} apply=${appliedEmpty}`);

  const page = await fetchRuleMatchPage(
    admin,
    clientId,
    { payeeQuery: "HCCLAIMPMT", matchType: "contains" },
    { labelNullOnly: true, offset: 0, limit: 50 }
  );
  assert(page.length === Math.min(50, willEmpty), "Spec64 live list drift");
  log(`5 Spec64 live-list page=${page.length} of will=${willEmpty}`);

  const stats = await fetchRulePayeeStats(admin, clientId, "COMCAST", {
    matchType: "contains",
  });
  assert((stats.by_month?.length ?? 0) >= 2, "COMCAST months expected");
  const month = stats.by_month!.find((p) => p.count >= 2) ?? stats.by_month![0]!;
  assert(month.from && month.to, "period from/to missing from RPC — run migration");
  const { from, to } = intersectDateRanges(null, null, month.from, month.to);
  const periodWill = await countRuleMatches(
    admin,
    clientId,
    {
      payeeQuery: "COMCAST",
      matchType: "contains",
      date_from: from,
      date_to: to,
    },
    { labelNullOnly: true }
  );
  const periodPage = await fetchRuleMatchPage(
    admin,
    clientId,
    {
      payeeQuery: "COMCAST",
      matchType: "contains",
      date_from: from,
      date_to: to,
    },
    { labelNullOnly: true, offset: 0, limit: 50 }
  );
  assert(
    periodPage.length === Math.min(50, periodWill),
    "period preview page !== predicate count"
  );
  assert(periodWill <= month.count, "period will_suggest exceeds bar count");
  log(
    `6 period filter month=${month.period} bar=${month.count} will=${periodWill} page=${periodPage.length} from=${from} to=${to}`
  );

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
    ...new Set((cxDates ?? []).map((r) => String(r.posted_date).slice(0, 10))),
  ].sort();
  const mid = Math.floor(dates.length / 2);
  const dateFrom = dates[Math.max(0, mid - 1)]!;
  const dateTo = dates[Math.min(dates.length - 1, mid + 1)]!;
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
  assert(ruleCx, "COMCAST date rule");
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
  const willBroad = await countRuleMatches(
    admin,
    clientId,
    { payeeQuery: "COMCAST", matchType: "contains" },
    { labelNullOnly: true }
  );
  const { count: sugWide } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id", { count: "exact", head: true })
    .eq("rule_id", ruleCx.id);
  assert(sugWide === willBroad, "date widen restore");
  log(`7 Spec63F date reconcile win=${winWill} wide=${sugWide}`);

  log("MANUAL: sidebar blocked; 3 columns; newest-first bars; period→col3; Δ format screenshot");
  log("FEEDBACK SWEEP: Spec66 A–C4 + regress 63/64.");

  await wipe(admin, clientId);
  log("reset client 4");
  log("PASS Spec 66");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
