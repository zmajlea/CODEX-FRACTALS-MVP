/**
 * Spec 49B Step 1 proof: POST reset against deployed app.
 * Expects 403 protected_demo_ffm on demo FFM; 501 on any other granted client.
 * Uses cookie session from signInWithPassword (same path as the browser).
 *
 * Usage:
 *   RESET_BASE_URL=https://codex-fractals-mvp.vercel.app node scripts/prove-reset-guard.mjs
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

const DEMO_FFM_ID = "823560fa-1f73-4032-9c77-d390a261735f";
const OPERATOR_EMAIL = "operator-test@codexone.test";
const OPERATOR_PASSWORD = "OperatorTest!2026";
const BASE =
  process.env.RESET_BASE_URL?.replace(/\/$/, "") ||
  "https://codex-fractals-mvp.vercel.app";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !service) {
  console.error("Missing Supabase env");
  process.exit(1);
}

function projectRefFromUrl(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return null;
  }
}

/** Build Cookie header matching @supabase/ssr storage for createServerClient. */
function sessionCookieHeader(session) {
  const ref = projectRefFromUrl(url);
  if (!ref) throw new Error("Could not parse project ref from SUPABASE URL");
  const name = `sb-${ref}-auth-token`;
  const payload = JSON.stringify(session);
  // @supabase/ssr stores base64- prefixed JSON (may chunk; session fits one cookie)
  const value = `base64-${Buffer.from(payload, "utf8").toString("base64url")}`;
  return `${name}=${value}`;
}

async function postReset(cookie, clientId) {
  const res = await fetch(
    `${BASE}/api/operator/treasury/clients/${clientId}/reset`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Accept: "application/json",
      },
    }
  );
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
}

async function countDemoBook(admin) {
  const { count: tx } = await admin
    .from("treasury_transactions")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", DEMO_FFM_ID);
  const { count: accounts } = await admin
    .from("treasury_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_user_id", DEMO_FFM_ID);
  return { transactions: tx ?? 0, accounts: accounts ?? 0 };
}

async function findOtherGrantedClient(admin, operatorId) {
  const { data: grants, error } = await admin
    .from("client_module_access")
    .select("client_user_id")
    .eq("granted_by", operatorId)
    .eq("status", "active")
    .neq("client_user_id", DEMO_FFM_ID)
    .limit(20);
  if (error) throw new Error(error.message);
  for (const g of grants ?? []) {
    if (g.client_user_id !== DEMO_FFM_ID) return g.client_user_id;
  }
  // Fallback: any active treasury grant where operator has operator role on tenant
  const { data: rows } = await admin
    .from("client_module_access")
    .select("client_user_id, distributor_tenant_id")
    .eq("status", "active")
    .neq("client_user_id", DEMO_FFM_ID)
    .limit(50);
  for (const row of rows ?? []) {
    const { data: role } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", operatorId)
      .eq("tenant_id", row.distributor_tenant_id)
      .eq("role", "operator")
      .maybeSingle();
    if (role) return row.client_user_id;
  }
  return null;
}

async function main() {
  console.log(`BASE=${BASE}`);
  console.log(`DEMO_FFM=${DEMO_FFM_ID}`);

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  const browser = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });

  const before = await countDemoBook(admin);
  console.log("demo book before", before);

  const { data: auth, error: signErr } = await browser.auth.signInWithPassword({
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
  });
  if (signErr || !auth.session) {
    throw new Error(`signIn: ${signErr?.message ?? "no session"}`);
  }
  const cookie = sessionCookieHeader(auth.session);
  const operatorId = auth.user.id;

  const demoHit = await postReset(cookie, DEMO_FFM_ID);
  console.log("POST demo FFM →", demoHit.status, demoHit.body);

  if (demoHit.status !== 403 || demoHit.body?.code !== "protected_demo_ffm") {
    throw new Error(
      `Expected 403 protected_demo_ffm on demo FFM, got ${demoHit.status} ${JSON.stringify(demoHit.body)}`
    );
  }

  const after = await countDemoBook(admin);
  console.log("demo book after", after);
  if (
    after.transactions !== before.transactions ||
    after.accounts !== before.accounts
  ) {
    throw new Error(
      `DEMO BOOK COUNTS CHANGED — abort. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
    );
  }

  const otherId = await findOtherGrantedClient(admin, operatorId);
  if (!otherId) {
    console.warn(
      "No other granted client found — skipping 501 check (demo refuse proved)."
    );
  } else {
    const otherHit = await postReset(cookie, otherId);
    console.log(`POST other ${otherId} →`, otherHit.status, otherHit.body);
    if (
      otherHit.status !== 501 ||
      otherHit.body?.code !== "reset_not_implemented"
    ) {
      throw new Error(
        `Expected 501 reset_not_implemented on other client, got ${otherHit.status} ${JSON.stringify(otherHit.body)}`
      );
    }
  }

  console.log("PASS — demo FFM refused; book unchanged; wipe path absent (501).");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
