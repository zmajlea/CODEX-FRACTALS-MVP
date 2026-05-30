import pg from "pg";
const cs = process.env.DB_URL;
const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("select tablename from pg_tables where schemaname='public' order by 1");
console.log("tables:", r.rows.map((x) => x.tablename).join(", ") || "(none)");
const ty = await c.query("select typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and typtype='e'");
console.log("enums:", ty.rows.map((x) => x.typname).join(", ") || "(none)");
await c.end();
