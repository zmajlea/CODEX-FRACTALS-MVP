/**
 * Dump rule suggestions for snapshot diff (Spec 30).
 *
 * Usage:
 *   npx tsx scripts/snapshot-rule-suggestions.ts --out snapshots/spec30-a.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";

type AdminClient = SupabaseClient<Database>;

const BENCH_EMAIL = "bench-import@codexone.test";
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

export type SuggestionSnapshotRow = {
  id: string;
  external_id: string;
  suggested_label: string | null;
  suggested_by_rule_id: string | null;
  suggestion_explanation: string | null;
};

export async function fetchSuggestionSnapshot(
  admin: AdminClient,
  clientUserId: string
): Promise<SuggestionSnapshotRow[]> {
  const PAGE = 1000;
  const rows: SuggestionSnapshotRow[] = [];
  let offset = 0;

  while (true) {
    const { data: page, error } = await admin
      .from("treasury_transactions")
      .select("id, external_id, suggested_label, suggested_by_rule_id, suggestion_explanation")
      .eq("client_user_id", clientUserId)
      .not("suggested_by_rule_id", "is", null)
      .order("id")
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!page || page.length === 0) break;
    rows.push(...(page as SuggestionSnapshotRow[]));
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return rows;
}

async function main() {
  loadEnvLocal();
  const outArg =
    process.argv.find((a) => a.startsWith("--out="))?.slice(6) ??
    (process.argv.includes("--out")
      ? process.argv[process.argv.indexOf("--out") + 1]
      : null);

  if (!outArg) {
    console.error("Usage: --out snapshots/spec30-a.json");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin: AdminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
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

  const snapshot = await fetchSuggestionSnapshot(admin, client.id);
  const outPath = join(ROOT, outArg);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`Wrote ${snapshot.length} suggestion rows → ${outArg}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
