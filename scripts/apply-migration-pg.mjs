/**
 * Applies supabase/migrations/*.sql via direct Postgres or Session pooler.
 * Set DATABASE_URL in .env.local to the URI from Supabase Dashboard → Database → Connection string (Session mode).
 */
import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const sqlPath = resolve(
  __dirname,
  "../supabase/migrations/20260530000000_initial_schema.sql"
);

loadEnvLocal(envPath);

const projectRef = "tswdwmtrirdhtwqmsasz";
const password = process.env.SUPABASE_DB_PASSWORD;
const encodedPassword = password ? encodeURIComponent(password) : null;

function poolerUrl(region, mode = "session") {
  const port = mode === "transaction" ? 6543 : 5432;
  const opts = `?options=reference%3D${projectRef}`;
  return `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:${port}/postgres${opts}`;
}

function buildCandidates() {
  const list = [];

  // Prefer explicit URI from dashboard (Session pooler works on IPv4 / Windows)
  if (process.env.DATABASE_URL) list.push(process.env.DATABASE_URL);
  if (process.env.SESSION_DATABASE_URL) list.push(process.env.SESSION_DATABASE_URL);

  if (encodedPassword) {
    // Regions that responded on your machine (eu-west-* first)
    for (const region of [
      "eu-west-1",
      "eu-west-2",
      "eu-central-1",
      "us-east-1",
      "us-west-1",
      "ap-southeast-1",
      "ap-northeast-1",
    ]) {
      list.push(poolerUrl(region, "session"));
    }
    list.push(
      `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`
    );
  }

  return [...new Set(list)];
}

const sql = readFileSync(sqlPath, "utf8");

async function tryConnect(connectionString) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

function maskUrl(url) {
  return url.replace(/:([^:@/]+)@/, ":****@");
}

async function main() {
  const candidates = buildCandidates();
  if (!candidates.length) {
    console.error(
      "Set DATABASE_URL (Session pooler URI from Supabase dashboard) in .env.local"
    );
    process.exit(1);
  }

  if (password && password.length < 10) {
    console.warn(
      "Warning: SUPABASE_DB_PASSWORD looks truncated. Quote it in .env.local if it contains #"
    );
  }

  let lastError;
  for (const url of candidates) {
    console.log("Trying:", maskUrl(url));
    try {
      const client = await tryConnect(url);
      console.log("Connected. Applying migration:", sqlPath);
      await client.query(sql);
      await client.end();
      console.log("Migration applied successfully.");
      console.log("\nWorking connection (save as DATABASE_URL in .env.local):");
      console.log(url.replace(password ?? "____", "YOUR_PASSWORD"));
      return;
    } catch (err) {
      lastError = err;
      console.warn("  Failed:", err.message);
    }
  }

  console.error(
    "\nCould not connect. On Windows, direct db.*.supabase.co is often IPv6-only."
  );
  console.error(
    "Copy the Session pooler URI from: Project Settings → Database → Connect → Session"
  );
  console.error("Set it as DATABASE_URL in .env.local, then run npm run db:apply again.");
  throw lastError;
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
