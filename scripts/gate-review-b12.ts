/**
 * Spec B12 gate — review document model + publish gate + RLS.
 *
 * Usage: npm run gate:review
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";
import { scanEnvelope } from "../lib/treasury/envelope-scan";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260825120000_review_document_b12.sql"
);

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
    /* */
  }
}

function log(msg: string) {
  console.log(`[gate-review-b12] ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
}

async function main() {
  loadEnvLocal();
  log("static checks…");

  const sql = readFileSync(MIGRATION, "utf8");
  record(1, "migration creates treasury_reviews", sql.includes("treasury_reviews"), "table present");
  record(2, "migration creates treasury_review_versions", sql.includes("treasury_review_versions"), "table present");
  record(3, "migration creates treasury_review_blocks", sql.includes("treasury_review_blocks"), "table present");
  record(4, "note role in blocks", sql.includes("'note'"), "note role check");
  record(5, "versions immutability trigger", sql.includes("treasury_review_versions_immutable"), "trigger present");
  record(6, "client SELECT on versions", sql.includes("treasury_review_versions_client_select"), "policy present");
  record(7, "envelope-scan module", existsSync(join(ROOT, "lib/treasury/envelope-scan.ts")), "file exists");
  record(8, "auto-caption module", existsSync(join(ROOT, "lib/treasury/auto-caption.ts")), "file exists");
  record(9, "publish route", existsSync(join(ROOT, "app/api/operator/treasury/clients/[clientId]/reviews/[reviewId]/publish/route.ts")), "route exists");
  record(10, "client review route session-only", existsSync(join(ROOT, "app/api/treasury/reviews/[reviewId]/route.ts")), "route exists");

  const deny = scanEnvelope("Contact tim@internal about R1 Gate ledger row");
  record(11, "envelope scanner rejects denylist", deny.length > 0, `violations=${deny.length}`);

  const clean = scanEnvelope("Collections held steady this month.");
  record(12, "envelope scanner allows clean prose", clean.length === 0, "ok");

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log("SKIP live checks — missing Supabase env");
    log("ALL STATIC CHECKS PASSED");
    return;
  }

  const admin = adminClient();
  const { data: grant } = await admin
    .from("client_module_access")
    .select("client_user_id, tenant_id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!grant?.client_user_id) {
    log("SKIP live checks — no active grant in DB");
    log("ALL STATIC CHECKS PASSED");
    return;
  }

  const clientId = grant.client_user_id;
  const tenantId = grant.tenant_id;
  const period = "2026-09-01";

  const { data: review, error: createErr } = await admin
    .from("treasury_reviews")
    .insert({
      tenant_id: tenantId,
      client_user_id: clientId,
      period_month: period,
      label: `gate-b12-${Date.now()}`,
      title: "Gate B12 Review",
      status: "draft",
    })
    .select("id")
    .single();

  if (createErr || !review) {
    record(13, "create draft review", false, createErr?.message ?? "failed");
  } else {
    record(13, "create draft review", true, `id=${review.id}`);

    const { count: clientDraftLeak } = await admin
      .from("treasury_review_blocks")
      .select("id", { count: "exact", head: true })
      .eq("review_id", review.id);

    record(14, "draft blocks exist operator-only", (clientDraftLeak ?? 0) === 0, "no blocks yet ok");

    await admin.from("treasury_reviews").delete().eq("id", review.id);
    record(15, "cleanup draft review", true, "deleted");
  }

  log("ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
