import pg from "pg";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD ?? "");
const url = `postgresql://postgres.tswdwmtrirdhtwqmsasz:${pw}@aws-1-us-west-2.pooler.supabase.com:5432/postgres`;

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected via aws-1-us-west-2 pooler");

for (const name of ["treasury_reviews", "treasury_review_versions", "treasury_review_blocks"]) {
  const r = await client.query(`SELECT to_regclass('public.${name}') AS reg`);
  console.log(name + " regclass:", r.rows[0]?.reg);
}

const constraints = await client.query(`
  SELECT conname, conrelid::regclass AS table_name
  FROM pg_constraint
  WHERE conname LIKE 'treasury_review%'
  ORDER BY 1
`);
console.log("Review constraints:", constraints.rows);

const tables = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND (table_name LIKE 'treasury_review%' OR table_name IN (
      'distributor_client_invites', 'treasury_analytics', 'treasury_metrics'
    ))
  ORDER BY 1
`);
console.log("Key tables:", tables.rows.map((r) => r.table_name));

const mig = await client.query(`
  SELECT version FROM supabase_migrations.schema_migrations
  ORDER BY version DESC LIMIT 8
`);
console.log(
  "Latest migration records:",
  mig.rows.map((r) => r.version)
);

await client.end();
