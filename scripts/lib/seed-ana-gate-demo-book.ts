/**
 * Shared ana-gate FFM demo book loader (0625 + 0871 reserve, SELECTHEALTH rule).
 * Used by seed-ana-gate-book.ts and seed-mcp-three-testers.ts.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTreasuryCsv, upsertCsvAccounts } from "../../lib/treasury/csv-import";
import { upsertTransactions } from "../../lib/treasury/upsert-transactions";
import { applyRulesForClient } from "../../lib/treasury/apply-rules-for-client";
import type { Database } from "../../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

export const DEFAULT_DEMO_CSV_PATHS = [
  "docs/summit-ffm-0625.csv",
  "docs/summit-ffm-0871-reserve.csv",
] as const;

export type SeedDemoBookResult = {
  accounts: number;
  transactions: number;
  needs_label: number;
  suggested: number;
  labeled: number;
};

/** Import FFM CSVs + SELECTHEALTH rule for one client. Idempotent on re-run. */
export async function seedAnaGateDemoBook(
  admin: AdminClient,
  clientUserId: string,
  createdByOperatorId: string,
  opts?: { csvPaths?: readonly string[]; log?: (msg: string) => void }
): Promise<SeedDemoBookResult> {
  const log = opts?.log ?? (() => {});
  const csvPaths = opts?.csvPaths ?? DEFAULT_DEMO_CSV_PATHS;

  for (const csvPath of csvPaths) {
    log(`Import ${csvPath}`);
    const csv = readFileSync(join(ROOT, csvPath), "utf8");
    const parsed = parseTreasuryCsv(csv, clientUserId);
    const r = parsed.reconcile;
    if (r.rowsNeedingDirection > 0) {
      throw new Error(`${r.rowsNeedingDirection} null-direction rows in ${csvPath}`);
    }
    await upsertCsvAccounts(admin, clientUserId, parsed.accountLabels);
    await upsertTransactions(admin, clientUserId, parsed.rows, "csv");
  }

  const { data: existingRule } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("match_merchant", "SELECTHEALTH")
    .eq("assign_label", "SELECTHEALTH")
    .eq("active", true)
    .maybeSingle();

  let ruleId = existingRule?.id;
  if (!ruleId) {
    const { data: created, error: ruleErr } = await admin
      .from("treasury_rules")
      .insert({
        client_user_id: clientUserId,
        created_by: createdByOperatorId,
        name: "SELECTHEALTH",
        match_merchant: "SELECTHEALTH",
        match_type: "contains",
        amount_min: null,
        amount_max: null,
        direction: null,
        cadence: null,
        assign_label: "SELECTHEALTH",
        active: true,
      })
      .select("id")
      .single();
    if (ruleErr || !created) {
      throw new Error(`rule insert: ${ruleErr?.message ?? "unknown"}`);
    }
    ruleId = created.id;
  }

  await applyRulesForClient(admin, clientUserId, ruleId);

  const { count: txCount } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false);
  const { count: accountCount } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId);
  const { count: suggested } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .is("label", null)
    .eq("has_pending_suggestion", true);
  const { count: labeled } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .not("label", "is", null);
  const { count: needsLabel } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .is("label", null)
    .eq("has_pending_suggestion", false);

  const { count: acct0617 } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientUserId)
    .ilike("label", "%0617%");
  if ((acct0617 ?? 0) > 0) {
    throw new Error("0617 account found — abort");
  }

  return {
    accounts: accountCount ?? 0,
    transactions: txCount ?? 0,
    needs_label: needsLabel ?? 0,
    suggested: suggested ?? 0,
    labeled: labeled ?? 0,
  };
}
