import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { operatorHasClientGrant } from "@/lib/auth/rbac";
import { upsertTransactions } from "@/lib/server/treasury-ingest";
import { applyRulesForClient } from "@/lib/server/treasury-rules";
import { parseTreasuryCsv, upsertCsvAccounts } from "@/lib/treasury/csv-import";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export const JOURNEY1_CLIENT_EMAIL = "journey1-test@codexone.test";
export const JOURNEY1_OPERATOR_EMAIL = "leander23@gmail.com";

const SEED_RULE_NAMES = ["Payroll (ADP)", "Office rent", "Equipment loan"] as const;

const SEED_RULES: Array<{
  name: (typeof SEED_RULE_NAMES)[number];
  match_merchant: string;
  direction: "out";
  cadence: string;
  assign_label: string;
}> = [
  {
    name: "Payroll (ADP)",
    match_merchant: "ADP",
    direction: "out",
    cadence: "biweekly",
    assign_label: "Payroll",
  },
  {
    name: "Office rent",
    match_merchant: "BIRCHWOOD",
    direction: "out",
    cadence: "monthly",
    assign_label: "Rent",
  },
  {
    name: "Equipment loan",
    match_merchant: "KUBOTA",
    direction: "out",
    cadence: "monthly",
    assign_label: "Debt service",
  },
];

const MANUAL_LABELS: Array<{ pattern: string; label: string }> = [
  { pattern: "%ACME CORP%", label: "Customer collections" },
  { pattern: "%NORTHWIND%", label: "Customer collections" },
  { pattern: "%HARTFORD%", label: "Insurance" },
  { pattern: "%NETSUITE%", label: "Software" },
  { pattern: "%MICROSOFT 365%", label: "Software" },
  { pattern: "%SALESFORCE%", label: "Software" },
];

export type SeedJourney1Context = {
  clientUserId: string;
  operatorUserId: string;
  tenantId: string;
};

export type SeedJourney1Result = {
  clientUserId: string;
  accounts: number;
  transactions_imported: number;
  rules_created: number;
  transactions_labeled: number;
  recommendations: {
    draft: number;
    sent: number;
    accepted: number;
    in_progress: number;
    done: number;
    declined: number;
  };
};

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export async function resolveUserByEmail(
  admin: AdminClient,
  email: string
): Promise<{ id: string; email: string } | null> {
  const { data, error } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (error || !data?.id || !data.email) return null;
  return { id: data.id, email: data.email };
}

export async function resolveSeedContext(admin: AdminClient): Promise<SeedJourney1Context> {
  const client = await resolveUserByEmail(admin, JOURNEY1_CLIENT_EMAIL);
  if (!client) {
    throw new Error(`Client not found: ${JOURNEY1_CLIENT_EMAIL}`);
  }
  if (
    client.email.toLowerCase() !== JOURNEY1_CLIENT_EMAIL.toLowerCase() ||
    !client.email.toLowerCase().endsWith("@codexone.test")
  ) {
    throw new Error(`Refusing seed: client email must be ${JOURNEY1_CLIENT_EMAIL}`);
  }

  const operator = await resolveUserByEmail(admin, JOURNEY1_OPERATOR_EMAIL);
  if (!operator) {
    throw new Error(`Operator not found: ${JOURNEY1_OPERATOR_EMAIL}`);
  }

  const grant = await operatorHasClientGrant(
    admin,
    operator.id,
    client.id,
    "treasury",
    { allowGlobalAdmin: true }
  );
  if (!grant) {
    throw new Error(
      `No active treasury grant for ${JOURNEY1_OPERATOR_EMAIL} over ${JOURNEY1_CLIENT_EMAIL}`
    );
  }

  return {
    clientUserId: client.id,
    operatorUserId: operator.id,
    tenantId: grant.tenantId,
  };
}

async function resetClientTreasurySeed(admin: AdminClient, clientUserId: string) {
  await admin.from("treasury_recommendations").delete().eq("client_user_id", clientUserId);

  const { data: clientRules } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId)
    .in("name", [...SEED_RULE_NAMES]);

  const ruleIds = (clientRules ?? []).map((r) => r.id);
  if (ruleIds.length > 0) {
    await admin.from("treasury_rule_rejections").delete().in("rule_id", ruleIds);
    await admin.from("treasury_rules").delete().in("id", ruleIds);
  }

  const { data: clientTxs } = await admin
    .from("treasury_transactions")
    .select("id")
    .eq("client_user_id", clientUserId);

  const txIds = (clientTxs ?? []).map((t) => t.id);
  if (txIds.length > 0) {
    await admin.from("treasury_rule_rejections").delete().in("transaction_id", txIds);
    await admin
      .from("treasury_transaction_suggestions")
      .delete()
      .in("transaction_id", txIds);
  }

  await admin
    .from("treasury_transactions")
    .update({
      label: null,
      label_source: null,
      labeled_by: null,
      labeled_at: null,
      suggested_label: null,
      suggested_by_rule_id: null,
      suggestion_status: null,
      suggestion_explanation: null,
      has_pending_suggestion: false,
    })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false);
}

async function importCsv(
  admin: AdminClient,
  clientUserId: string,
  csvText: string
): Promise<number> {
  const parsed = parseTreasuryCsv(csvText, clientUserId);
  await upsertCsvAccounts(admin, clientUserId, parsed.accountLabels);
  const { upserted } = await upsertTransactions(admin, clientUserId, parsed.rows, "csv");
  return upserted;
}

async function seedRulesAndLabels(
  admin: AdminClient,
  clientUserId: string,
  operatorUserId: string
): Promise<{ rulesCreated: number; transactionsLabeled: number }> {
  const ruleIds: string[] = [];

  for (const rule of SEED_RULES) {
    const { data, error } = await admin
      .from("treasury_rules")
      .insert({
        client_user_id: clientUserId,
        created_by: operatorUserId,
        name: rule.name,
        match_merchant: rule.match_merchant,
        match_type: "contains",
        direction: rule.direction,
        cadence: rule.cadence,
        assign_label: rule.assign_label,
        active: true,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create rule ${rule.name}: ${error?.message ?? "unknown"}`);
    }
    ruleIds.push(data.id);
  }

  await applyRulesForClient(admin, clientUserId);

  const now = new Date().toISOString();
  let ruleConfirmed = 0;

  if (ruleIds.length > 0) {
    // Spec 58 — confirm from suggestions table (tx suggested_* cleared after migrate)
    const { data: suggested } = await admin
      .from("treasury_transaction_suggestions")
      .select("transaction_id, rule_id, suggested_label")
      .eq("client_user_id", clientUserId)
      .in("rule_id", ruleIds);

    const seen = new Set<string>();
    for (const sug of suggested ?? []) {
      if (seen.has(sug.transaction_id)) continue;
      seen.add(sug.transaction_id);
      const { error } = await admin
        .from("treasury_transactions")
        .update({
          label: sug.suggested_label,
          label_source: "rule_confirmed",
          labeled_by: operatorUserId,
          labeled_at: now,
          suggested_label: null,
          suggested_by_rule_id: sug.rule_id,
          suggestion_status: "confirmed",
          suggestion_explanation: null,
        })
        .eq("id", sug.transaction_id);
      if (!error) {
        await admin
          .from("treasury_transaction_suggestions")
          .delete()
          .eq("transaction_id", sug.transaction_id);
        ruleConfirmed += 1;
      }
    }
  }

  let manualLabeled = 0;
  for (const { pattern, label } of MANUAL_LABELS) {
    const { data: matches } = await admin
      .from("treasury_transactions")
      .select("id")
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .ilike("raw_name", pattern);

    for (const tx of matches ?? []) {
      const { error } = await admin
        .from("treasury_transactions")
        .update({
          label,
          label_source: "manual",
          labeled_by: operatorUserId,
          labeled_at: now,
          suggested_label: null,
          suggested_by_rule_id: null,
          suggestion_status: null,
          suggestion_explanation: null,
        })
        .eq("id", tx.id);
      if (!error) manualLabeled += 1;
    }
  }

  return {
    rulesCreated: ruleIds.length,
    transactionsLabeled: ruleConfirmed + manualLabeled,
  };
}

function operatingAnchor(): Database["public"]["Tables"]["treasury_recommendations"]["Insert"]["anchor_ref"] {
  return { account_id: "csv:Operating", name: "Operating", mask: null };
}

async function seedRecommendations(
  admin: AdminClient,
  ctx: SeedJourney1Context
): Promise<SeedJourney1Result["recommendations"]> {
  const { clientUserId, operatorUserId, tenantId } = ctx;
  const now = new Date().toISOString();
  const opAnchor = operatingAnchor();

  const rows: Database["public"]["Tables"]["treasury_recommendations"]["Insert"][] = [
    {
      client_user_id: clientUserId,
      operator_tenant_id: tenantId,
      created_by: operatorUserId,
      title: "Consolidate overlapping SaaS subscriptions",
      category: "cost",
      why: "NetSuite, Salesforce and Microsoft 365 overlap on CRM and reporting (~$4.7k/mo combined). Consolidating onto one suite should trim ~15%.",
      impact_amount: 700,
      impact_basis: "per_month",
      anchor_type: "account",
      anchor_ref: opAnchor,
      status: "draft",
      created_at: daysAgoIso(18),
      updated_at: daysAgoIso(18),
    },
    {
      client_user_id: clientUserId,
      operator_tenant_id: tenantId,
      created_by: operatorUserId,
      title: "Sweep idle Operating cash into Reserve",
      category: "liquidity",
      why: "Operating has held above $400k for six straight months while Reserve earns interest and Operating doesn't. Sweep $150k to Reserve and keep an operating floor.",
      impact_amount: 5200,
      impact_basis: "per_year",
      anchor_type: "account",
      anchor_ref: opAnchor,
      status: "sent",
      sealed_at: daysAgoIso(15),
      sealed_by: operatorUserId,
      sent_at: daysAgoIso(15),
      client_seen_at: null,
      created_at: daysAgoIso(15),
      updated_at: daysAgoIso(15),
    },
    {
      client_user_id: clientUserId,
      operator_tenant_id: tenantId,
      created_by: operatorUserId,
      title: "Refinance the Kubota equipment loan",
      category: "financing",
      why: "The Kubota loan runs $6,730/mo at a legacy rate. Current market refi terms would lower the monthly and free up cash.",
      impact_amount: 9000,
      impact_basis: "per_year",
      anchor_type: "account",
      anchor_ref: opAnchor,
      status: "accepted",
      sealed_at: daysAgoIso(12),
      sealed_by: operatorUserId,
      sent_at: daysAgoIso(12),
      decided_at: daysAgoIso(10),
      operator_seen_at: null,
      client_seen_at: daysAgoIso(11),
      created_at: daysAgoIso(12),
      updated_at: daysAgoIso(10),
    },
    {
      client_user_id: clientUserId,
      operator_tenant_id: tenantId,
      created_by: operatorUserId,
      title: "Renegotiate Midwest Steel payment terms (net-45)",
      category: "cost",
      why: "Midwest Steel is the largest variable outflow. Moving from net-30 to net-45 smooths the month-end troughs without changing price.",
      impact_amount: 12000,
      impact_basis: "per_year",
      anchor_type: "account",
      anchor_ref: opAnchor,
      status: "in_progress",
      sealed_at: daysAgoIso(9),
      sealed_by: operatorUserId,
      sent_at: daysAgoIso(9),
      decided_at: daysAgoIso(8),
      operator_seen_at: now,
      client_seen_at: daysAgoIso(8),
      created_at: daysAgoIso(9),
      updated_at: daysAgoIso(7),
    },
    {
      client_user_id: clientUserId,
      operator_tenant_id: tenantId,
      created_by: operatorUserId,
      title: "Establish a second banking relationship",
      category: "risk",
      why: "All balances sit at a single institution. Opening a second banking relationship reduces concentration and gives a backup rail.",
      impact_amount: null,
      impact_basis: "one_time",
      anchor_type: "general",
      anchor_ref: null,
      status: "done",
      sealed_at: daysAgoIso(6),
      sealed_by: operatorUserId,
      sent_at: daysAgoIso(6),
      decided_at: daysAgoIso(5),
      operator_seen_at: now,
      client_seen_at: daysAgoIso(5),
      created_at: daysAgoIso(6),
      updated_at: daysAgoIso(4),
    },
    {
      client_user_id: clientUserId,
      operator_tenant_id: tenantId,
      created_by: operatorUserId,
      title: "Move fleet fuel onto a discount fuel card",
      category: "cost",
      why: "Weekly Shell fuel runs ~$1.4k/mo. A fleet fuel card with a per-gallon discount would cut that with no operational change.",
      impact_amount: 1800,
      impact_basis: "per_year",
      anchor_type: "account",
      anchor_ref: opAnchor,
      status: "declined",
      sealed_at: daysAgoIso(2),
      sealed_by: operatorUserId,
      sent_at: daysAgoIso(2),
      decided_at: daysAgoIso(2),
      decline_reason: "Not a priority now",
      decline_note: "Fleet is being downsized next quarter.",
      operator_seen_at: null,
      client_seen_at: daysAgoIso(2),
      created_at: daysAgoIso(2),
      updated_at: daysAgoIso(2),
    },
  ];

  const { error } = await admin.from("treasury_recommendations").insert(rows);
  if (error) {
    throw new Error(`Failed to seed recommendations: ${error.message}`);
  }

  return {
    draft: 1,
    sent: 1,
    accepted: 1,
    in_progress: 1,
    done: 1,
    declined: 1,
  };
}

export async function seedJourney1Treasury(
  admin: AdminClient,
  csvText: string
): Promise<SeedJourney1Result> {
  const ctx = await resolveSeedContext(admin);
  const { clientUserId } = ctx;

  await resetClientTreasurySeed(admin, clientUserId);
  const transactionsImported = await importCsv(admin, clientUserId, csvText);
  const { rulesCreated, transactionsLabeled } = await seedRulesAndLabels(
    admin,
    clientUserId,
    ctx.operatorUserId
  );
  const recommendations = await seedRecommendations(admin, ctx);

  const { count: accountCount } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId);

  return {
    clientUserId,
    accounts: accountCount ?? 0,
    transactions_imported: transactionsImported,
    rules_created: rulesCreated,
    transactions_labeled: transactionsLabeled,
    recommendations,
  };
}
