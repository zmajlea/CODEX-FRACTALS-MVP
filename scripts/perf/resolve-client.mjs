/**
 * Resolve ana_gate_client_4 id + display_name for perf journey.
 * Usage: node scripts/perf/resolve-client.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  let k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  }
);

const email = "ana_gate_client_4@codexone.test";
const { data, error } = await admin
  .from("users")
  .select("id,email,display_name")
  .ilike("email", email)
  .maybeSingle();
if (error || !data) {
  console.error(error ?? "missing");
  process.exit(1);
}
const { count } = await admin
  .from("treasury_transactions")
  .select("id", { count: "exact", head: true })
  .eq("client_user_id", data.id)
  .eq("is_removed", false);
console.log(
  JSON.stringify({ ...data, tx_count: count ?? 0 }, null, 2)
);
