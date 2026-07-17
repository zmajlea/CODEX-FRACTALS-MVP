/**
 * Spec 34 P0 E2E acceptance on bench-import client.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import { fetchAllRows } from "../lib/treasury/fetch-all-rows";
import { querySummary } from "../lib/treasury/query-summary";
import {
  buildSummaryResponse,
} from "../lib/server/treasury-summary-response";
import {
  lastNPeriodStarts,
  periodEnd,
  periodStartOf,
  shiftPeriods,
  todayIso,
} from "../lib/treasury/period-bounds";
import type { Database } from "../lib/database.types";
import type { TreasuryRuleRow } from "../lib/treasury/types";

type AdminClient = SupabaseClient<Database>;

const ROOT = join(__dirname, "..");
const BENCH_EMAIL = "bench-import@codexone.test";
const SELECTHEALTH_RULE_ID = "b56bebeb-632b-4c91-8b2d-0e2af2d92b54";

function loadEnvLocal() {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function adminClient(): AdminClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      realtime: { transport: ws as unknown as typeof WebSocket },
    }
  );
}

async function countMatches(
  admin: AdminClient,
  clientUserId: string,
  ruleId: string
): Promise<number> {
  const live = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("id")
      .eq("client_user_id", clientUserId)
      .eq("suggestion_status", "suggested")
      .eq("suggested_by_rule_id", ruleId)
      .order("id", { ascending: true })
      .range(from, to)
  );
  const confirmed = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("id")
      .eq("client_user_id", clientUserId)
      .eq("label_source", "rule_confirmed")
      .eq("suggested_by_rule_id", ruleId)
      .order("id", { ascending: true })
      .range(from, to)
  );
  return live.length + confirmed.length;
}

function seedFullyInside(
  granularity: "week" | "month",
  baselineK: number,
  dataFirst: string,
  dataLast: string
): boolean {
  const today = todayIso();
  const currentPeriod = periodStartOf(granularity, today);
  const lastCompleteStart = shiftPeriods(granularity, currentPeriod, -1);
  const baselineStarts: string[] = [];
  for (let i = baselineK - 1; i >= 0; i--) {
    baselineStarts.push(shiftPeriods(granularity, lastCompleteStart, -i));
  }
  return baselineStarts.every((start) => {
    const end = periodEnd(granularity, start);
    return start >= dataFirst && end <= dataLast;
  });
}

async function main() {
  loadEnvLocal();
  const admin = adminClient();

  const { data: userData } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = userData.users.find((u) => u.email === BENCH_EMAIL);
  if (!user) throw new Error(`Bench user ${BENCH_EMAIL} not found`);
  const clientId = user.id;
  console.log("bench client", clientId);

  const { data: ruleRow } = await admin
    .from("treasury_rules")
    .select("*")
    .eq("id", SELECTHEALTH_RULE_ID)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (!ruleRow) {
    throw new Error("SELECTHEALTH rule missing");
  }
  void (ruleRow as TreasuryRuleRow);

  // Clear prior SELECTHEALTH suggestions/confirms for a clean apply
  await admin
    .from("treasury_transactions")
    .update({
      suggested_label: null,
      suggested_by_rule_id: null,
      suggestion_status: null,
      suggestion_explanation: null,
      label: null,
      label_source: null,
      labeled_at: null,
      labeled_by: null,
    })
    .eq("client_user_id", clientId)
    .eq("suggested_by_rule_id", SELECTHEALTH_RULE_ID);

  console.log("1) apply SELECTHEALTH…");
  const suggested = await applyRulesForClient(admin, clientId, SELECTHEALTH_RULE_ID);
  console.log("   apply returned", suggested);

  const matchedAfterApply = await countMatches(admin, clientId, SELECTHEALTH_RULE_ID);
  console.log("2) matched after apply", matchedAfterApply);
  if (matchedAfterApply < 200) {
    throw new Error(`Expected matched ~244 after apply, got ${matchedAfterApply}`);
  }

  console.log("3) confirm all…");
  const toConfirm = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("id, suggested_label")
      .eq("client_user_id", clientId)
      .eq("suggested_by_rule_id", SELECTHEALTH_RULE_ID)
      .eq("suggestion_status", "suggested")
      .order("id", { ascending: true })
      .range(from, to)
  );

  const now = new Date().toISOString();
  let confirmed = 0;
  for (const tx of toConfirm) {
    const { data } = await admin
      .from("treasury_transactions")
      .update({
        label: tx.suggested_label,
        label_source: "rule_confirmed",
        labeled_at: now,
        suggested_label: null,
        suggestion_status: "confirmed",
        suggestion_explanation: null,
      })
      .eq("id", tx.id)
      .select("id");
    if (data?.length) confirmed += 1;
  }
  console.log("4) confirmed", confirmed);

  const matchedAfterConfirm = await countMatches(admin, clientId, SELECTHEALTH_RULE_ID);
  console.log("4b) matched after confirm", matchedAfterConfirm);
  if (matchedAfterConfirm !== matchedAfterApply) {
    throw new Error(
      `Handoff failed: matched dropped from ${matchedAfterApply} to ${matchedAfterConfirm}`
    );
  }

  console.log("5) summary dataSpan…");
  const dateRows = await fetchAllRows((from, to) =>
    admin
      .from("treasury_transactions")
      .select("posted_date")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .eq("pending", false)
      .not("posted_date", "is", null)
      .order("posted_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  let dataFirst: string | null = null;
  let dataLast: string | null = null;
  for (const row of dateRows) {
    const d = row.posted_date as string;
    if (!dataFirst || d < dataFirst) dataFirst = d;
    if (!dataLast || d > dataLast) dataLast = d;
  }
  const { from, to, starts } = lastNPeriodStarts("week", 26);
  const sparse = await querySummary(admin, clientId, { bucket: "week", from, to });
  const summary = buildSummaryResponse(sparse, {
    granularity: "week",
    periods: 26,
    from,
    to,
    starts,
    dataFirst,
    dataLast,
  });
  const phantom = summary.rows.filter(
    (r) => dataLast && r.period_start > dataLast && r.count === 0
  );
  console.log("   data_span", summary.data_span);
  console.log("   weeks", summary.rows.length, "phantom", phantom.length);
  if (phantom.length > 0) throw new Error("Phantom zero weeks remain");

  console.log("6) refuse WEEKLY + MONTHLY…");
  if (!dataFirst || !dataLast) throw new Error("no data span");
  for (const [g, n] of [
    ["week", 12],
    ["month", 6],
  ] as const) {
    const ok = seedFullyInside(g, n, dataFirst, dataLast);
    console.log(`   ${g}: seedFullyInside=${ok} (expect false → refuse)`);
    if (ok) throw new Error(`${g} should refuse on this fixture`);
  }

  const { data: stamped } = await admin
    .from("treasury_rules")
    .select("last_applied_at")
    .eq("id", SELECTHEALTH_RULE_ID)
    .single();
  console.log("   last_applied_at", stamped?.last_applied_at);
  if (!stamped?.last_applied_at) throw new Error("last_applied_at not stamped");

  console.log("\nPASS Spec 34 P0 E2E");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
