/**
 * Apply a single SQL file via Postgres (same connection logic as apply-migration-pg.mjs).
 * Usage: node scripts/apply-sql-file.mjs supabase/migrations/20260530160000_temporal_objects_queryable.sql
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

const relPath = process.argv[2];
if (!relPath) {
  console.error("Usage: node scripts/apply-sql-file.mjs <path-to.sql>");
  process.exit(1);
}

const sqlPath = resolve(__dirname, "..", relPath);
const sql = readFileSync(sqlPath, "utf8");

function poolerUrl(region) {
  const opts = `?options=reference%3D${projectRef}`;
  return `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:5432/postgres${opts}`;
}

function buildCandidates() {
  const list = [];
  if (process.env.DATABASE_URL) list.push(process.env.DATABASE_URL);
  if (process.env.SESSION_DATABASE_URL) list.push(process.env.SESSION_DATABASE_URL);
  if (encodedPassword) {
    for (const region of [
      "eu-west-1",
      "eu-west-2",
      "eu-central-1",
      "us-east-1",
      "us-west-1",
    ]) {
      list.push(poolerUrl(region));
    }
  }
  return [...new Set(list)];
}

async function main() {
  const candidates = buildCandidates();
  if (!candidates.length) {
    console.error("Set DATABASE_URL or SUPABASE_DB_PASSWORD in .env.local");
    process.exit(1);
  }

  let lastError;
  for (const url of candidates) {
    const host = url.replace(/:([^:@/]+)@/, ":****@");
    console.log("Trying:", host);
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      console.log("Connected. Applying:", sqlPath);
      await client.query(sql);
      await client.end();
      console.log("Migration applied successfully.");
      return;
    } catch (err) {
      lastError = err;
      console.warn("  Failed:", err.message);
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }
  throw lastError;
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
