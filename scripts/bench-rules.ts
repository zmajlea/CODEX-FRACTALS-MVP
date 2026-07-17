/**
 * Spec 30 rule-save benchmark — times applyRulesForClient only (post-import).
 *
 * Usage:
 *   npm run treasury:bench-rules -- --setup-rule SELECTHEALTH
 *   npm run treasury:bench-rules -- --rule-id <uuid>
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const BENCH_EMAIL = "bench-import@codexone.test";
const ROOT = join(__dirname, "..");

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
    // optional
  }
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const setupRule =
    args.find((a) => a.startsWith("--setup-rule="))?.slice(13) ??
    (args.includes("--setup-rule") ? args[args.indexOf("--setup-rule") + 1] : null);
  const ruleIdArg =
    args.find((a) => a.startsWith("--rule-id="))?.slice(10) ??
    (args.includes("--rule-id") ? args[args.indexOf("--rule-id") + 1] : null);

  const admin: AdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: client } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", BENCH_EMAIL)
    .maybeSingle();

  if (!client) {
    console.error("Run npm run test:seed:bench-import");
    process.exit(1);
  }

  log(`Bench client: ${client.email}`);

  let ruleId = ruleIdArg ?? null;

  if (setupRule) {
    const operatorId = (
      await admin
        .from("users")
        .select("id")
        .ilike("email", "operator-test@codexone.test")
        .maybeSingle()
    ).data?.id;

    await admin.from("treasury_rules").delete().eq("client_user_id", client.id);
    const { data: inserted, error: ruleErr } = await admin
      .from("treasury_rules")
      .insert({
        client_user_id: client.id,
        created_by: operatorId ?? client.id,
        name: `Bench ${setupRule}`,
        match_merchant: setupRule,
        match_type: "contains",
        assign_label: "Bench rule label",
        active: true,
      })
      .select("id")
      .single();

    if (ruleErr) throw ruleErr;
    ruleId = inserted.id;
    log(`Rule created: match_merchant=${setupRule} (${ruleId})`);
  }

  if (!ruleId) {
    const { data: existing } = await admin
      .from("treasury_rules")
      .select("id, match_merchant")
      .eq("client_user_id", client.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      console.error("No rule — pass --setup-rule SELECTHEALTH or --rule-id");
      process.exit(1);
    }
    ruleId = existing.id;
    log(`Using existing rule: ${existing.match_merchant} (${ruleId})`);
  }

  const t0 = performance.now();
  const suggested = await applyRulesForClient(admin, client.id, ruleId);
  const elapsedMs = performance.now() - t0;

  console.log(
    `\nRule save apply: ${(elapsedMs / 1000).toFixed(2)}s | suggested ${suggested} rows`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
