/**
 * Quick probe: head count on users, vaults, fake_table_xyz
 * Usage: node scripts/probe-tables.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

function loadEnv() {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.error("Missing .env.local");
    process.exit(1);
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const TABLES = ["users", "vaults", "fake_table_xyz"];

async function main() {
  console.log("Probing at", url, "\n");
  for (const table of TABLES) {
    const result = await supabase.from(table).select("id", { head: true, count: "exact" });
    console.log(`--- ${table} ---`);
    if (result.error) {
      console.log("ERROR:", JSON.stringify(result.error, null, 2));
    } else {
      console.log("SUCCESS:", JSON.stringify({ count: result.count, status: result.status, statusText: result.statusText }, null, 2));
    }
    console.log();
  }
}

main();
