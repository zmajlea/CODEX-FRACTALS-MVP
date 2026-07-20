/**
 * Spec 49B — import → reset → re-import on an empty gate client (client 2).
 * Uses the operator session against RESET_BASE_URL (default production).
 *
 * Usage: RESET_BASE_URL=https://codex-fractals-mvp.vercel.app npx tsx scripts/prove-reset-roundtrip.ts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { parseTreasuryCsv, upsertCsvAccounts } from "../lib/treasury/csv-import";
import { upsertTransactions } from "../lib/treasury/upsert-transactions";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

loadEnvLocal();

const DEMO_FFM_ID = "823560fa-1f73-4032-9c77-d390a261735f";
const OPERATOR_EMAIL = "r1_gate_operator@codexone.test";
const OPERATOR_PASSWORD = "r1_gate_2026!";
const CLIENT_EMAIL = "r1_gate_client_2@codexone.test";
const CLIENT_NAME = "R1 Gate Client 2";
const BASE =
  process.env.RESET_BASE_URL?.replace(/\/$/, "") ||
  "https://codex-fractals-mvp.vercel.app";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function projectRefFromUrl(supabaseUrl: string) {
  return new URL(supabaseUrl).hostname.split(".")[0];
}

function sessionCookieHeader(session: {
  access_token: string;
  refresh_token: string;
  [k: string]: unknown;
}) {
  const ref = projectRefFromUrl(url);
  const name = `sb-${ref}-auth-token`;
  const payload = JSON.stringify(session);
  const value = `base64-${Buffer.from(payload, "utf8").toString("base64url")}`;
  return `${name}=${value}`;
}

async function counts(admin: any, clientId: string) {
  const tables = [
    "treasury_transactions",
    "treasury_accounts",
    "treasury_rules",
    "treasury_recommendations",
    "treasury_studies",
  ] as const;
  const out: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await admin
      .from(t)
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", clientId);
    out[t] = count ?? 0;
  }
  return out;
}

async function main() {
  console.log(`BASE=${BASE}`);
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });
  const browser = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });

  const { data: clientRow } = await admin
    .from("users")
    .select("id, email, display_name")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();
  if (!clientRow) throw new Error("client 2 missing");
  const clientId = clientRow.id;
  console.log("scratch client", clientId);

  const { data: opRow } = await admin
    .from("users")
    .select("id")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();
  if (!opRow) throw new Error("operator missing");

  // Seed a small book + rule + study + draft + sealed rec
  const csv = readFileSync(join(ROOT, "docs/summit-ffm-0625.csv"), "utf8");
  const parsed = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed.accountLabels);
  await upsertTransactions(admin, clientId, parsed.rows, "csv");

  await admin.from("treasury_rules").insert({
    client_user_id: clientId,
    created_by: opRow.id,
    name: "SELECTHEALTH",
    match_merchant: "SELECTHEALTH",
    match_type: "contains",
    assign_label: "SELECTHEALTH",
    active: true,
  });

  const { data: tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("domain_slug", "r1-gate")
    .maybeSingle();

  await admin.from("treasury_studies").insert({
    client_user_id: clientId,
    operator_tenant_id: tenant!.id,
    created_by: opRow.id,
    name: "Scratch study",
    type: "spend_plan",
    scope: {},
    params: {},
    scenarios: [],
    derived_snapshot: {},
  });

  await admin.from("treasury_recommendations").insert([
    {
      client_user_id: clientId,
      operator_tenant_id: tenant!.id,
      created_by: opRow.id,
      title: "Draft scratch",
      why: "test",
      category: "cash",
      kind: "recommendation",
      status: "draft",
      evidence: [],
    },
    {
      client_user_id: clientId,
      operator_tenant_id: tenant!.id,
      created_by: opRow.id,
      title: "Sent scratch",
      why: "test",
      category: "cash",
      kind: "recommendation",
      status: "sent",
      sealed_at: new Date().toISOString(),
      sealed_by: opRow.id,
      sent_at: new Date().toISOString(),
      evidence: [],
    },
  ]);

  const before = await counts(admin, clientId);
  console.log("before", before);
  if (before.treasury_transactions < 1000) {
    throw new Error("expected imported book");
  }

  const { data: auth, error: signErr } = await browser.auth.signInWithPassword({
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
  });
  if (signErr || !auth.session) throw new Error(signErr?.message ?? "no session");
  const cookie = sessionCookieHeader(auth.session);

  const preview = await fetch(
    `${BASE}/api/operator/treasury/clients/${clientId}/reset`,
    { headers: { Cookie: cookie, Accept: "application/json" } }
  );
  const previewBody = await preview.json();
  console.log("GET preview", preview.status, previewBody);
  if (preview.status !== 200) {
    throw new Error(`preview failed: ${JSON.stringify(previewBody)}`);
  }

  const reset = await fetch(
    `${BASE}/api/operator/treasury/clients/${clientId}/reset`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm_name: CLIENT_NAME }),
    }
  );
  const resetBody = await reset.json();
  console.log("POST reset", reset.status, resetBody);
  if (reset.status !== 200 || !resetBody.ok) {
    throw new Error(`reset failed: ${JSON.stringify(resetBody)}`);
  }

  const after = await counts(admin, clientId);
  console.log("after reset", after);
  for (const [k, v] of Object.entries(after)) {
    if (v !== 0) throw new Error(`${k} not zero after reset: ${v}`);
  }

  // Grant + profile intact
  const { data: grant } = await admin
    .from("client_module_access")
    .select("id, status")
    .eq("client_user_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  if (!grant) throw new Error("grant missing after reset");

  const { data: profile } = await admin
    .from("treasury_client_operator_profile")
    .select("client_user_id")
    .eq("client_user_id", clientId)
    .maybeSingle();
  if (!profile) throw new Error("profile missing after reset");

  // Re-import
  const parsed2 = parseTreasuryCsv(csv, clientId);
  await upsertCsvAccounts(admin, clientId, parsed2.accountLabels);
  const up = await upsertTransactions(admin, clientId, parsed2.rows, "csv");
  console.log("re-import", up);
  const re = await counts(admin, clientId);
  console.log("after re-import", re);
  if (re.treasury_transactions < 1000 || re.treasury_accounts < 1) {
    throw new Error("re-import failed");
  }

  // Demo still protected
  const demo = await fetch(
    `${BASE}/api/operator/treasury/clients/${DEMO_FFM_ID}/reset`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm_name: "FFM Demo Client" }),
    }
  );
  // r1-gate operator may not have grant on demo → 403 Forbidden is also OK;
  // prove with operator-test separately if needed
  console.log("POST demo as r1-gate op", demo.status, await demo.text());

  // Client login cannot reset
  const { data: clientAuth } = await browser.auth.signInWithPassword({
    email: CLIENT_EMAIL,
    password: OPERATOR_PASSWORD,
  });
  if (!clientAuth.session) throw new Error("client sign-in failed");
  const clientCookie = sessionCookieHeader(clientAuth.session);
  const asClient = await fetch(
    `${BASE}/api/operator/treasury/clients/${clientId}/reset`,
    {
      method: "POST",
      headers: {
        Cookie: clientCookie,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ confirm_name: CLIENT_NAME }),
    }
  );
  console.log("POST as client", asClient.status, await asClient.text());
  if (asClient.status !== 401 && asClient.status !== 403) {
    throw new Error(`expected client refuse, got ${asClient.status}`);
  }

  console.log("PASS — round trip + client refuse");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
