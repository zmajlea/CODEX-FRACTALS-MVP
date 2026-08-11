/**
 * Apply one migration SQL file via DATABASE_URL / pooler (same as apply-migration-pg.mjs).
 * Usage: node scripts/apply-one-migration.mjs supabase/migrations/20260723110000_treasury_transaction_suggestions.sql
 */
import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const projectRef = "tswdwmtrirdhtwqmsasz";
const password = process.env.SUPABASE_DB_PASSWORD;
const encodedPassword = password ? encodeURIComponent(password) : null;
const sqlRel = process.argv[2];
if (!sqlRel) {
  console.error("Usage: node scripts/apply-one-migration.mjs <path-to.sql>");
  process.exit(1);
}
const sqlPath = resolve(__dirname, "..", sqlRel);
const sql = readFileSync(sqlPath, "utf8");

function poolerUrl(prefix, region) {
  return `postgresql://postgres.${projectRef}:${encodedPassword}@${prefix}-${region}.pooler.supabase.com:5432/postgres`;
}

function candidates() {
  const list = [];
  // Prefer session pooler; direct db.*.supabase.co is often IPv6-only on Windows
  if (process.env.SESSION_DATABASE_URL) list.push(process.env.SESSION_DATABASE_URL);
  if (encodedPassword) {
    // Confirmed live host: aws-1-us-west-2 (journey / Spec 67)
    for (const prefix of ["aws-1", "aws-0"]) {
      for (const r of [
        "us-west-2",
        "eu-west-1",
        "eu-west-2",
        "eu-central-1",
        "us-east-1",
      ]) {
        list.push(poolerUrl(prefix, r));
      }
    }
  }
  if (process.env.DATABASE_URL) list.push(process.env.DATABASE_URL);
  return [...new Set(list)];
}

async function main() {
  for (const url of candidates()) {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      console.log("Connected — applying", sqlRel);
      await client.query(sql);
      console.log("OK");
      await client.end();
      return;
    } catch (e) {
      try {
        await client.end();
      } catch {
        /* */
      }
      console.warn("fail", e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  console.error("No working DATABASE_URL");
  process.exit(1);
}

main();
