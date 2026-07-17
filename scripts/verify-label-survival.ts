/**
 * Label survival on re-import (Spec 29 acceptance).
 * Run: npm run treasury:verify-label-survival
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";

const BENCH_EMAIL = "bench-import@codexone.test";
const CSV = "docs/summit-ffm-0625.csv";
const ROOT = join(__dirname, "..");

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: client } = await admin
    .from("users")
    .select("id")
    .ilike("email", BENCH_EMAIL)
    .maybeSingle();

  if (!client) {
    console.error("Run npm run test:seed:bench-import");
    process.exit(1);
  }

  const csv = readFileSync(join(ROOT, CSV), "utf8");
  const parsed = parseTreasuryCsv(csv, client.id);
  await upsertCsvAccounts(admin, client.id, parsed.accountLabels);
  const first = await upsertTransactions(admin, client.id, parsed.rows, "csv");
  console.log(`First import: inserted ${first.inserted}, updated ${first.updated}`);

  const { data: sample } = await admin
    .from("treasury_transactions")
    .select("id, external_id, raw_name")
    .eq("client_user_id", client.id)
    .eq("source", "csv")
    .limit(1)
    .maybeSingle();

  if (!sample) {
    console.error("No transaction to label");
    process.exit(1);
  }

  const label = "Manual survival test";
  const labeledAt = new Date().toISOString();
  const { error: labelErr } = await admin
    .from("treasury_transactions")
    .update({
      label,
      label_source: "manual",
      labeled_by: client.id,
      labeled_at: labeledAt,
    })
    .eq("id", sample.id);

  if (labelErr) throw labelErr;
  console.log(`Labeled tx ${sample.external_id} (${sample.raw_name})`);

  const second = await upsertTransactions(admin, client.id, parsed.rows, "csv");
  console.log(`Re-import: inserted ${second.inserted}, updated ${second.updated}`);

  const { data: after } = await admin
    .from("treasury_transactions")
    .select("label, label_source, labeled_at")
    .eq("id", sample.id)
    .maybeSingle();

  const ok =
    after?.label === label &&
    after?.label_source === "manual" &&
    after?.labeled_at != null &&
    second.inserted === 0 &&
    second.updated === parsed.rows.length;

  if (ok) {
    console.log("\nLabel survival: PASS");
  } else {
    console.error("\nLabel survival: FAIL", { after, second });
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
