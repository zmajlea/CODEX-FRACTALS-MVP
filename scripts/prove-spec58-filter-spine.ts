/**
 * Spec 58 filter-spine proof — before UI.
 * Compares EXISTS ground truth vs has_pending_suggestion vs applyTxPredicate.
 * Usage: npx tsx scripts/prove-spec58-filter-spine.ts [clientEmail]
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { applyTxPredicate } from "../lib/treasury/tx-predicate";
import type { Database } from "../lib/database.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_EMAIL =
  process.argv[2] ?? "ana_gate_client_1@codexone.test";

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

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: user } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  if (!user) throw new Error(`missing ${CLIENT_EMAIL}`);
  const clientId = user.id;
  console.log(`Client ${user.email} (${clientId})`);

  // Ground truth via EXISTS (SQL-shaped filters through admin)
  const { count: total } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", clientId)
    .eq("is_removed", false);

  // Fetch all ids+label+has_pending for truth (paginated) — proof only, not product path
  const rows: Array<{
    id: string;
    label: string | null;
    has_pending_suggestion: boolean;
  }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("treasury_transactions")
      .select("id, label, has_pending_suggestion")
      .eq("client_user_id", clientId)
      .eq("is_removed", false)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(
      ...(data as Array<{
        id: string;
        label: string | null;
        has_pending_suggestion: boolean;
      }>)
    );
    if (data.length < 1000) break;
  }

  const { data: sugRows, error: sugErr } = await admin
    .from("treasury_transaction_suggestions")
    .select("transaction_id")
    .eq("client_user_id", clientId);
  if (sugErr) throw sugErr;
  const existsSet = new Set((sugRows ?? []).map((r) => r.transaction_id));

  let gtUncat = 0;
  let gtSug = 0;
  let gtConf = 0;
  let flagMismatch = 0;
  for (const r of rows) {
    const exists = existsSet.has(r.id);
    if (!!r.has_pending_suggestion !== exists) flagMismatch++;
    if (r.label != null) gtConf++;
    else if (exists) gtSug++;
    else gtUncat++;
  }

  // Predicate path (product spine)
  async function countStatus(status: "needs_label" | "suggested" | "labeled") {
    const base = () =>
      applyTxPredicate(
        admin
          .from("treasury_transactions")
          .select("id", { count: "exact", head: true })
          .eq("client_user_id", clientId)
          .eq("is_removed", false),
        { status }
      );
    const { count, error } = await base();
    if (error) throw error;
    return count ?? 0;
  }

  const predUncat = await countStatus("needs_label");
  const predSug = await countStatus("suggested");
  const predConf = await countStatus("labeled");

  // RPC portfolio needs_label for this client
  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("domain_slug", "ana-gate")
    .maybeSingle();
  let rpcNeeds: number | null = null;
  if (tenant) {
    const { data: rpc } = await admin.rpc("list_operator_treasury_clients", {
      p_tenant_id: tenant.id,
    });
    const list = (rpc as Array<{ client_user_id: string; needs_label_count?: number }>) ?? [];
    const hit = list.find((c) => c.client_user_id === clientId);
    rpcNeeds = hit?.needs_label_count ?? null;
  }

  console.log("\n=== Spec 58 three-state query proof ===");
  console.log("Exact queries (product):");
  console.log("  uncategorised: label.is.null AND has_pending_suggestion.eq.false");
  console.log("  suggested:     label.is.null AND has_pending_suggestion.eq.true");
  console.log("  confirmed:     label.not.is.null");
  console.log("Ground truth: EXISTS via treasury_transaction_suggestions.");
  console.log({
    total,
    rows_scanned: rows.length,
    suggestion_rows: sugRows?.length ?? 0,
    flag_vs_exists_mismatches: flagMismatch,
    ground_truth: { uncategorised: gtUncat, suggested: gtSug, confirmed: gtConf },
    applyTxPredicate: {
      needs_label: predUncat,
      suggested: predSug,
      labeled: predConf,
    },
    rpc_needs_label_count: rpcNeeds,
  });

  const ok =
    flagMismatch === 0 &&
    predUncat === gtUncat &&
    predSug === gtSug &&
    predConf === gtConf &&
    (rpcNeeds == null || rpcNeeds === gtUncat) &&
    gtUncat + gtSug + gtConf === rows.length;

  if (!ok) {
    console.error("FAIL — spine does not reconcile");
    process.exit(1);
  }
  console.log(
    "PASS — EXISTS ≡ has_pending_suggestion ≡ applyTxPredicate ≡ needs_label_count RPC"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
