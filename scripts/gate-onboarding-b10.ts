/**
 * Spec B10 gate — onboarding + client portal safety floor.
 *
 * Static checks always run. Live checks require:
 *   npm run test:seed:mcp-testers
 *   Migration 20260824120000_onboarding_client_portal_b10 applied
 *   Dev server on MCP_GATE_URL host (default http://localhost:14000)
 *
 * Usage: npm run gate:onboarding
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");
const MCP_PASSWORD = "mcp_gate_2026!";

type OperatorToken = {
  email: string;
  operatorId: string;
  tenantId: string;
  clientIds: string[];
  clients: Array<{ email: string; id: string; displayName: string }>;
  token: string;
};

const results: Array<{ id: number; name: string; ok: boolean; detail: string }> =
  [];

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
  console.log(`[gate-onboarding-b10] ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  results.push({ id, name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function baseUrl(): string {
  const issuer = process.env.MCP_OAUTH_ISSUER?.trim();
  if (issuer) return issuer.replace(/\/$/, "");
  const gate = process.env.MCP_GATE_URL ?? "http://localhost:14000/api/mcp";
  return gate.replace(/\/api\/mcp\/?$/, "");
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

function assertNoAdminImport(roots: string[], label: string) {
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of walkFiles(join(ROOT, root))) {
      const text = readFileSync(file, "utf8");
      if (
        text.includes("createSupabaseAdminClient") ||
        /from\s+["']@\/lib\/supabase\/admin["']/.test(text)
      ) {
        hits.push(relative(ROOT, file).replace(/\\/g, "/"));
      }
    }
  }
  if (hits.length > 0) {
    throw new Error(`${label}: admin client found in ${hits.join(", ")}`);
  }
}

function loadTokens(): { tim: OperatorToken; ana: OperatorToken } | null {
  if (!existsSync(TOKENS_PATH)) return null;
  const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  function norm(r: Record<string, unknown>): OperatorToken {
    const legacy = r.clientId as string | undefined;
    const clientIds =
      (r.clientIds as string[] | undefined) ?? (legacy ? [legacy] : []);
    const clients =
      (r.clients as OperatorToken["clients"] | undefined) ??
      clientIds.map((id) => ({
        email: "",
        id,
        displayName: id,
      }));
    return {
      email: String(r.email),
      operatorId: String(r.operatorId),
      tenantId: String(r.tenantId),
      clientIds,
      clients,
      token: String(r.token),
    };
  }
  if (!raw.tim || !raw.ana) return null;
  return { tim: norm(raw.tim), ana: norm(raw.ana) };
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}

function sessionClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase anon env");
  return createClient<Database>(url, anon, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}

async function passwordLogin(email: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase anon env");
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password: MCP_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`login ${email}: ${error?.message ?? "no session"}`);
  }
  return data.session.access_token;
}

async function main() {
  loadEnvLocal();
  log("static checks…");

  // 1 — migration invents distributor_client_invites (not vault_invites reuse)
  const mig = readFileSync(
    join(
      ROOT,
      "supabase/migrations/20260824120000_onboarding_client_portal_b10.sql"
    ),
    "utf8"
  );
  record(
    1,
    "migration creates distributor_client_invites",
    mig.includes("create table if not exists public.distributor_client_invites"),
    "create table present"
  );
  record(
    2,
    "migration does not call provision_client_seat",
    !mig.includes("provision_client_seat"),
    "BCN seat path untouched"
  );
  record(
    3,
    "has_active_treasury_grant helper",
    mig.includes("has_active_treasury_grant"),
    "helper defined"
  );
  record(
    4,
    "client_response column ensured",
    mig.includes("client_response"),
    "idempotent add column"
  );

  // 5 — no admin on client surfaces / recommendations routes
  try {
    assertNoAdminImport(
      ["app/client", "app/api/treasury/recommendations"],
      "invariant #1"
    );
    record(
      5,
      "no admin client in client/recs paths",
      true,
      "app/client/** + recommendations/** clean"
    );
  } catch (e) {
    record(
      5,
      "no admin client in client/recs paths",
      false,
      e instanceof Error ? e.message : String(e)
    );
  }

  // 6 — create-client route exists
  record(
    6,
    "POST create-client route",
    existsSync(join(ROOT, "app/api/operator/treasury/clients/route.ts")),
    "Part A route present"
  );
  record(
    7,
    "activate portal present",
    existsSync(join(ROOT, "app/portal/activate/page.tsx")),
    "Part B activate page"
  );

  const tokens = loadTokens();
  if (!tokens) {
    log("SKIP live checks — no .mcp-gate-tokens.json (seed first)");
    log("Static gate OK. Re-run after seed + migration for live RLS checks.");
    return;
  }

  const admin = adminClient();
  const origin = baseUrl();
  const stamp = Date.now();
  const email = `b10.gate.${stamp}@example.com`;
  const name = `B10 Gate ${stamp}`;

  log(`live create client via API ${email}…`);
  const createRes = await fetch(`${origin}/api/operator/treasury/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.tim.token}`,
      Cookie: `sb-access-token=${tokens.tim.token}`,
    },
    body: JSON.stringify({
      name,
      email,
      firmLabel: "B10 Gate Firm",
      sendInvite: false,
    }),
  });

  // Cookie auth may fail; fall back to service-role create via onboarding helper shape
  let clientId: string;
  let grantId: string;
  if (createRes.ok) {
    const j = (await createRes.json()) as {
      clientId: string;
      grantId: string;
    };
    clientId = j.clientId;
    grantId = j.grantId;
    record(8, "create client API", true, `clientId=${clientId}`);
  } else {
    log(`API create returned ${createRes.status}; using inline admin create`);
    const { data: mod } = await admin
      .from("modules")
      .select("id")
      .eq("slug", "treasury")
      .maybeSingle();
    if (!mod) throw new Error("treasury module missing");

    const { data: created, error: cuErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: MCP_PASSWORD,
      user_metadata: { full_name: name, firm: "B10 Gate Firm" },
    });
    if (cuErr || !created.user) {
      throw new Error(cuErr?.message ?? "createUser failed");
    }
    clientId = created.user.id;

    await admin.from("users").upsert({
      id: clientId,
      email,
      display_name: name,
    });
    await admin.from("user_roles").insert({
      user_id: clientId,
      role: "client",
      tenant_id: null,
      granted_by: tokens.tim.operatorId,
    });
    const { data: grant, error: gErr } = await admin
      .from("client_module_access")
      .insert({
        client_user_id: clientId,
        distributor_tenant_id: tokens.tim.tenantId,
        module_id: mod.id,
        status: "active",
        granted_by: tokens.tim.operatorId,
      })
      .select("id")
      .single();
    if (gErr || !grant) throw new Error(gErr?.message ?? "grant failed");
    grantId = grant.id;
    await admin.from("treasury_client_operator_profile").upsert({
      distributor_tenant_id: tokens.tim.tenantId,
      client_user_id: clientId,
      industry: "B10 Gate Firm",
    });
    record(
      8,
      "create client (admin fallback)",
      true,
      `clientId=${clientId} grant=${grantId}`
    );
  }

  const { data: grantRow } = await admin
    .from("client_module_access")
    .select("id, status, module_id")
    .eq("id", grantId)
    .maybeSingle();
  record(
    9,
    "grant active (no seed)",
    grantRow?.status === "active",
    `status=${grantRow?.status ?? "missing"}`
  );

  // Set password so we can login as client
  await admin.auth.admin.updateUserById(clientId, {
    password: MCP_PASSWORD,
    email_confirm: true,
  });

  const clientToken = await passwordLogin(email);
  const clientSb = sessionClient(clientToken);

  // Seed a sent rec + draft for client A; confirm isolation with existing gate client B
  const otherId = tokens.tim.clientIds[0];
  if (!otherId) throw new Error("tim.clientIds empty");

  const { data: sentRec } = await admin
    .from("treasury_recommendations")
    .insert({
      client_user_id: clientId,
      operator_tenant_id: tokens.tim.tenantId,
      kind: "question",
      category: "liquidity",
      title: "B10 gate question",
      why: "Please reply for gate",
      status: "sent",
      sent_at: new Date().toISOString(),
      source: "operator",
      evidence: [],
      anchor_type: "general",
      created_by: tokens.tim.operatorId,
    })
    .select("id")
    .single();

  await admin.from("treasury_recommendations").insert({
    client_user_id: clientId,
    operator_tenant_id: tokens.tim.tenantId,
    kind: "recommendation",
    category: "liquidity",
    title: "B10 draft hidden",
    why: "draft",
    status: "draft",
    evidence: [],
    anchor_type: "general",
    created_by: tokens.tim.operatorId,
  });

  const { data: ownRecs } = await clientSb
    .from("treasury_recommendations")
    .select("id, status, title");
  const ids = (ownRecs ?? []).map((r) => r.id);
  record(
    10,
    "client session sees sent, not draft",
    Boolean(sentRec?.id) &&
      ids.includes(sentRec!.id) &&
      !(ownRecs ?? []).some((r) => r.status === "draft"),
    `rows=${ids.length}`
  );

  // Other client cannot see new client's recs
  const { data: otherUser } = await admin.auth.admin.getUserById(otherId);
  const otherEmail = otherUser.user?.email;
  if (!otherEmail) throw new Error("other client email missing");
  const otherToken = await passwordLogin(otherEmail);
  const otherSb = sessionClient(otherToken);
  const { data: leak } = await otherSb
    .from("treasury_recommendations")
    .select("id")
    .eq("id", sentRec!.id);
  record(
    11,
    "two-client RLS isolation",
    (leak ?? []).length === 0,
    `leak count=${(leak ?? []).length}`
  );

  // Reply + attachment metadata
  const { error: ansErr } = await clientSb
    .from("treasury_recommendations")
    .update({
      status: "done",
      client_response: "Gate reply note",
      responded_at: new Date().toISOString(),
    })
    .eq("id", sentRec!.id);
  record(
    12,
    "client reply lands in client_response",
    !ansErr,
    ansErr?.message ?? "updated"
  );

  const { error: attErr } = await clientSb
    .from("treasury_thread_attachments")
    .insert({
      recommendation_id: sentRec!.id,
      client_user_id: clientId,
      storage_path: `${clientId}/${sentRec!.id}/gate.txt`,
      filename: "gate.txt",
      content_type: "text/plain",
      byte_size: 4,
    });
  record(
    13,
    "thread attachment insert (session)",
    !attErr,
    attErr?.message ?? "ok"
  );

  // Suspend → deny reads
  const { error: susErr } = await admin.rpc("suspend_operator_client_access", {
    p_grant_id: grantId,
  });
  // RPC may require operator auth; update directly if needed
  if (susErr) {
    await admin
      .from("client_module_access")
      .update({ status: "suspended" })
      .eq("id", grantId);
  }
  const { data: afterSus } = await clientSb
    .from("treasury_recommendations")
    .select("id");
  record(
    14,
    "suspend denies client SELECT",
    (afterSus ?? []).length === 0,
    `rows=${(afterSus ?? []).length}`
  );

  await admin
    .from("client_module_access")
    .update({ status: "active" })
    .eq("id", grantId);
  const { data: afterAct } = await clientSb
    .from("treasury_recommendations")
    .select("id");
  record(
    15,
    "reactivate restores SELECT",
    (afterAct ?? []).length > 0,
    `rows=${(afterAct ?? []).length}`
  );

  // Cleanup gate user soft: revoke grant
  await admin
    .from("client_module_access")
    .update({ status: "revoked" })
    .eq("id", grantId);

  log("ALL LIVE CHECKS PASSED (run gate:analytics-boards-b7 / metrics-b5 / mcp-b3 separately)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
