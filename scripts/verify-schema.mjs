/**
 * Verifies Fractals MVP tables exist in Supabase (run after migration).
 * Usage: node scripts/verify-schema.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const TABLES = [
  "users",
  "vaults",
  "vault_members",
  "records",
  "files",
  "temporal_objects",
];

async function tableExists(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  if (res.ok) return true;

  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }

  const code = body?.code ?? "";
  const message = body?.message ?? "";
  if (code === "PGRST205" || message.includes("schema cache")) {
    return false;
  }

  // Table exists but RLS returned an error other than "missing table"
  return true;
}

async function main() {
  console.log("Checking schema at", url, "\n");
  let ok = 0;
  for (const table of TABLES) {
    const exists = await tableExists(table);
    if (exists) {
      console.log(`  ✓ ${table}`);
      ok += 1;
    } else {
      console.log(`  ✗ ${table}: not in schema (run migration)`);
    }
  }
  console.log(`\n${ok}/${TABLES.length} tables present.`);
  process.exit(ok === TABLES.length ? 0 : 1);
}

main();
