/**
 * Wipe csv treasury data for bench-import@codexone.test (Spec 29 A/B).
 *
 * Usage: npm run test:wipe:bench-import
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const BENCH_CLIENT_EMAIL = "bench-import@codexone.test";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

function log(step, detail = "") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("Missing env vars");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const { data: client, error: clientErr } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", BENCH_CLIENT_EMAIL)
    .maybeSingle();

  if (clientErr || !client) {
    throw new Error(`${BENCH_CLIENT_EMAIL} not found — run npm run test:seed:bench-import`);
  }

  log("Wipe", `${client.email} (${client.id})`);

  const { data: rules } = await admin
    .from("treasury_rules")
    .select("id")
    .eq("client_user_id", client.id);
  const ruleIds = (rules ?? []).map((r) => r.id);
  if (ruleIds.length > 0) {
    await admin.from("treasury_rule_rejections").delete().in("rule_id", ruleIds);
    const { error } = await admin.from("treasury_rules").delete().in("id", ruleIds);
    if (error) throw new Error(`rules delete: ${error.message}`);
    log("Rules", `deleted ${ruleIds.length}`);
  }

  const { data: txs } = await admin
    .from("treasury_transactions")
    .select("id")
    .eq("client_user_id", client.id);
  const txIds = (txs ?? []).map((t) => t.id);
  if (txIds.length > 0) {
    await admin.from("treasury_rule_rejections").delete().in("transaction_id", txIds);
  }

  const { count: txCount, error: txErr } = await admin
    .from("treasury_transactions")
    .delete({ count: "exact" })
    .eq("client_user_id", client.id)
    .eq("source", "csv");
  if (txErr) throw new Error(`transactions delete: ${txErr.message}`);
  log("Transactions", `deleted ${txCount ?? 0} csv rows`);

  const { count: acctCount, error: acctErr } = await admin
    .from("treasury_accounts")
    .delete({ count: "exact" })
    .eq("client_user_id", client.id);
  if (acctErr) throw new Error(`accounts delete: ${acctErr.message}`);
  log("Accounts", `deleted ${acctCount ?? 0}`);

  console.log("\nBench client wiped (csv txs + accounts + rules).");
}

main().catch((err) => {
  console.error("\nWipe failed:", err.message ?? err);
  process.exit(1);
});
