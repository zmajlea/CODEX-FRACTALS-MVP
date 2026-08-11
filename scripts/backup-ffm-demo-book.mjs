/**
 * One-shot Gate 1 backup: demo FFM client book → local JSON.
 * Client: 823560fa-1f73-4032-9c77-d390a261735f
 *
 * Usage: node scripts/backup-ffm-demo-book.mjs
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const CLIENT_ID = "823560fa-1f73-4032-9c77-d390a261735f";
const PAGE = 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

async function countExact(admin, table, filterCol = "client_user_id") {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(filterCol, CLIENT_ID);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

async function fetchAll(admin, table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .eq("client_user_id", CLIENT_ID)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(
    __dirname,
    "../../backups",
    `ffm-demo-${CLIENT_ID.slice(0, 8)}-${stamp}`
  );
  mkdirSync(outDir, { recursive: true });

  const tables = [
    "treasury_transactions",
    "treasury_accounts",
    "treasury_rules",
    "treasury_recommendations",
  ];

  const manifest = {
    client_user_id: CLIENT_ID,
    exported_at: new Date().toISOString(),
    supabase_url: url,
    tables: {},
  };

  let ok = true;
  for (const table of tables) {
    const dbCount = await countExact(admin, table);
    const rows = await fetchAll(admin, table);
    const path = join(outDir, `${table}.json`);
    writeFileSync(path, JSON.stringify(rows, null, 2), "utf8");
    const match = rows.length === dbCount;
    manifest.tables[table] = {
      db_count: dbCount,
      file_count: rows.length,
      match,
      file: `${table}.json`,
    };
    console.log(
      `${match ? "OK" : "MISMATCH"} ${table}: db=${dbCount} file=${rows.length}`
    );
    if (!match) ok = false;

    if (table === "treasury_recommendations") {
      const withEvidence = rows.filter(
        (r) =>
          r.evidence != null &&
          !(Array.isArray(r.evidence) && r.evidence.length === 0) &&
          !(
            typeof r.evidence === "object" &&
            !Array.isArray(r.evidence) &&
            Object.keys(r.evidence).length === 0
          )
      );
      console.log(`  evidence present on ${withEvidence.length}/${rows.length} recommendations`);
    }
  }

  // Also pull rule_rejections if any (client-scoped via rules)
  const ruleIds = (
    JSON.parse(readFileSync(join(outDir, "treasury_rules.json"), "utf8"))
  ).map((r) => r.id);
  let rejections = [];
  if (ruleIds.length) {
    for (let i = 0; i < ruleIds.length; i += 100) {
      const chunk = ruleIds.slice(i, i + 100);
      const { data, error } = await admin
        .from("treasury_rule_rejections")
        .select("*")
        .in("rule_id", chunk);
      if (error) {
        console.warn(`treasury_rule_rejections: ${error.message}`);
        break;
      }
      rejections.push(...(data ?? []));
    }
  }
  writeFileSync(
    join(outDir, "treasury_rule_rejections.json"),
    JSON.stringify(rejections, null, 2),
    "utf8"
  );
  manifest.tables.treasury_rule_rejections = {
    file_count: rejections.length,
    file: "treasury_rule_rejections.json",
  };
  console.log(`OK treasury_rule_rejections: file=${rejections.length}`);

  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  console.log(`\nBackup dir: ${outDir}`);
  for (const table of tables) {
    if (!existsSync(join(outDir, `${table}.json`))) {
      console.error(`Missing file: ${table}.json`);
      ok = false;
    }
  }

  if (!ok) {
    console.error("\nGate 1 FAILED — count mismatch");
    process.exit(1);
  }
  console.log("\nGate 1 PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
