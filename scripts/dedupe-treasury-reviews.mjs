/**
 * Spec B13 — archive duplicate treasury_reviews rows sharing (tenant, client, period_month, label).
 * Keeps: published over draft; else newest updated_at.
 *
 * Usage:
 *   node scripts/dedupe-treasury-reviews.mjs              # dry-run
 *   node scripts/dedupe-treasury-reviews.mjs --apply
 *   node scripts/dedupe-treasury-reviews.mjs --apply --client-email r1_gate_client_1@codexone.test
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const apply = process.argv.includes("--apply");
const clientEmailArg = process.argv.find((a) => a.startsWith("--client-email="));
const clientEmailFilter = clientEmailArg?.split("=")[1]?.trim();

async function findAuthUserByEmail(admin, email) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

function pickKeeper(rows) {
  const published = rows.filter((r) => r.status === "published");
  if (published.length) {
    return published.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
  }
  return rows.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  )[0];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  let clientIdFilter = null;
  if (clientEmailFilter) {
    const user = await findAuthUserByEmail(admin, clientEmailFilter);
    if (!user) {
      console.error(`Client not found: ${clientEmailFilter}`);
      process.exit(1);
    }
    clientIdFilter = user.id;
    console.log(`Filter client: ${clientEmailFilter} (${clientIdFilter})`);
  }

  let q = admin
    .from("treasury_reviews")
    .select("id, tenant_id, client_user_id, period_month, label, title, status, updated_at")
    .neq("status", "archived");
  if (clientIdFilter) q = q.eq("client_user_id", clientIdFilter);

  const { data: reviews, error } = await q;
  if (error) throw error;

  const groups = new Map();
  for (const r of reviews ?? []) {
    const key = `${r.tenant_id}|${r.client_user_id}|${r.period_month}|${r.label ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const dupes = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  if (!dupes.length) {
    console.log("No duplicate review groups found.");
    return;
  }

  console.log(`${apply ? "APPLY" : "DRY-RUN"} — ${dupes.length} duplicate group(s)\n`);

  for (const [key, rows] of dupes) {
    const keeper = pickKeeper(rows);
    const archive = rows.filter((r) => r.id !== keeper.id);
    console.log(`Group ${key}`);
    console.log(`  KEEP  ${keeper.id}  ${keeper.status}  "${keeper.title}"  updated=${keeper.updated_at}`);
    for (const r of archive) {
      console.log(`  ARCH  ${r.id}  ${r.status}  "${r.title}"  updated=${r.updated_at}`);
      if (apply) {
        const { error: upErr } = await admin
          .from("treasury_reviews")
          .update({ status: "archived" })
          .eq("id", r.id);
        if (upErr) throw upErr;
      }
    }
    console.log("");
  }

  if (!apply) {
    console.log("Re-run with --apply to archive duplicates.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
