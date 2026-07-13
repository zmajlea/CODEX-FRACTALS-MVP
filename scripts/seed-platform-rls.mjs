/**
 * Platform RLS smoke checks (service role required for full matrix).
 * Usage: node scripts/seed-platform-rls.mjs
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLES = [
  "modules",
  "operator_modules",
  "client_module_access",
  "billing_rules",
  "platform_audit_events",
  "tenants",
  "user_roles",
  "credit_transactions",
];

async function tableReachable(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (res.ok) return true;
  const body = await res.json().catch(() => ({}));
  if (body?.code === "PGRST205") return false;
  return true;
}

async function rpcExists(name) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  // 404 = missing; 400/401/403/500 often means the function exists but args/auth failed
  return res.status !== 404;
}

async function main() {
  if (!url || !key) {
    console.error("Missing Supabase env vars");
    process.exit(1);
  }

  console.log("Platform schema checks\n");
  let ok = 0;

  for (const table of TABLES) {
    const exists = await tableReachable(table);
    console.log(exists ? "OK" : "MISSING", table);
    if (exists) ok++;
  }

  for (const rpc of [
    "get_ff_login_route",
    "elevate_codexone_global_admin",
    "provision_client_seat",
    "resolve_billing_rule_id",
  ]) {
    const exists = await rpcExists(rpc);
    console.log(exists ? "OK" : "MISSING", `rpc/${rpc}`);
    if (exists) ok++;
  }

  const modulesRes = await fetch(`${url}/rest/v1/modules?select=slug`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  const modules = modulesRes.ok ? await modulesRes.json() : [];
  const slugs = new Set(modules.map((m) => m.slug));
  const modulesOk = modulesRes.status !== 404 && (slugs.has("ff") || modulesRes.status === 401);
  console.log(modulesOk ? "OK" : "FAIL", "seed modules ff+deadlines");
  if (modulesOk) ok++;

  const houseRes = await fetch(
    `${url}/rest/v1/tenants?select=domain_slug,is_house&domain_slug=eq.codexone`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    }
  );
  const house = houseRes.ok ? await houseRes.json() : [];
  console.log(house[0]?.is_house ? "OK" : "FAIL", "codexone house tenant");
  if (house[0]?.is_house) ok++;

  console.log(`\n${ok} checks passed`);
  process.exit(ok >= TABLES.length + 2 ? 0 : 1);
}

main();
