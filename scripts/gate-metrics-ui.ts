/**
 * Spec B4 gate — Metrics tab APIs: create/preview/compute/edit/discard + isolation.
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   Dev server on MCP_GATE_URL host (default http://localhost:14000)
 *   After Part A: gate:mcp-b3 still passes
 *
 * Usage: npm run gate:metrics-ui
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import ws from "ws";
import type { Database } from "../lib/database.types";
import { createMetric } from "../lib/treasury/metrics-define";
import { findMetricForClient } from "../lib/treasury/metrics-eval";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");
const MCP_PASSWORD = "mcp_gate_2026!";

type OperatorToken = {
  email: string;
  operatorId: string;
  tenantId: string;
  clientIds: string[];
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
  console.log(`[gate-metrics-ui] ${msg}`);
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

function loadTokens(): { tim: OperatorToken; ana: OperatorToken } {
  const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  function norm(r: Record<string, unknown>): OperatorToken {
    const legacy = r.clientId as string | undefined;
    const clientIds =
      (r.clientIds as string[] | undefined) ?? (legacy ? [legacy] : []);
    return {
      email: String(r.email),
      operatorId: String(r.operatorId),
      tenantId: String(r.tenantId),
      clientIds,
      token: String(r.token),
    };
  }
  return { tim: norm(raw.tim!), ana: norm(raw.ana!) };
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

/** Build sb-*-auth-token cookie(s) for Next SSR from a session. */
function sessionCookieHeader(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: unknown;
}): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ref = new URL(url).hostname.split(".")[0]!;
  const name = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type ?? "bearer",
    user: session.user,
  });
  // @supabase/ssr stores base64- prefixed values
  const b64 = Buffer.from(payload, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const value = `base64-${b64}`;
  // Chunk if large (4KB cookie limit) — session usually fits one chunk
  if (value.length < 3500) {
    return `${name}=${encodeURIComponent(value)}`;
  }
  const chunks: string[] = [];
  let i = 0;
  let offset = 0;
  while (offset < value.length) {
    const slice = value.slice(offset, offset + 3180);
    chunks.push(`${name}.${i}=${encodeURIComponent(slice)}`);
    offset += 3180;
    i += 1;
  }
  return chunks.join("; ");
}

async function signIn(email: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: MCP_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signIn ${email}: ${error?.message ?? "no session"}`);
  }
  return data.session;
}

async function opFetch(
  cookie: string,
  path: string,
  init: RequestInit = {}
) {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Cookie: cookie,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

function parseToolText(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  if (result.isError) {
    throw new Error(result.content?.[0]?.text ?? "MCP error");
  }
  return JSON.parse(result.content?.[0]?.text ?? "{}") as unknown;
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
  const url = process.env.MCP_GATE_URL ?? "http://localhost:14000/api/mcp";
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "gate-metrics-ui", version: "1.0.0" });
  await client.connect(transport);
  try {
    const raw = await client.callTool({ name, arguments: args });
    return parseToolText(raw as never);
  } finally {
    await transport.close();
  }
}

const collectionsAvgDef = {
  of: "monthly_totals",
  source: { type: "category", key: "collections", direction: "in" },
  op: "avg",
  window: { kind: "trailing", months: 3 },
};

const pctOfDef = {
  of: "monthly_totals",
  source: { type: "category", key: "payroll", direction: "out" },
  op: "pct_of",
  window: { kind: "trailing", months: 3 },
  of2: {
    of: "monthly_totals",
    source: { type: "category", key: "collections", direction: "in" },
    op: "sum",
    window: { kind: "trailing", months: 3 },
  },
};

async function main() {
  loadEnvLocal();
  if (!existsSync(TOKENS_PATH)) {
    throw new Error("Missing .mcp-gate-tokens.json — run test:seed:mcp-testers");
  }
  process.env.MCP_DEV_TOKENS_ENABLED = "true";

  const { tim, ana } = loadTokens();
  const admin = adminClient();
  const timClient = tim.clientIds[0]!;
  const anaClient = ana.clientIds[0]!;
  const otherTimClient = tim.clientIds[1]!;

  const timSession = await signIn(tim.email);
  const anaSession = await signIn(ana.email);
  const timCookie = sessionCookieHeader(timSession);
  const anaCookie = sessionCookieHeader(anaSession);

  let metricId: string | undefined;
  let pctMetricId: string | undefined;

  {
    const name = `gate_b4_collections_avg_${Date.now()}`;
    const { status, json } = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "Trailing 3mo collections avg",
          definition: collectionsAvgDef,
          scope: "client",
        }),
      }
    );
    const metric = json.metric as
      | {
          id: string;
          source: string;
          status: string;
          computed_value?: { value?: number };
        }
      | undefined;
    const ok =
      status === 201 &&
      metric?.source === "platform" &&
      metric?.status === "active" &&
      typeof metric.computed_value?.value === "number";
    metricId = metric?.id;
    record(
      1,
      "POST create (guided-equivalent)",
      ok,
      `status=${status} source=${metric?.source} value=${metric?.computed_value?.value}`
    );
  }

  {
    const name = `gate_b4_pct_${Date.now()}`;
    const { status, json } = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "payroll % of collections",
          definition: pctOfDef,
          scope: "client",
        }),
      }
    );
    const metric = json.metric as { id?: string; source?: string } | undefined;
    pctMetricId = metric?.id;
    record(
      2,
      "POST create raw JSON pct_of",
      status === 201 && metric?.source === "platform",
      `status=${status}`
    );
  }

  {
    const okPreview = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/preview`,
      {
        method: "POST",
        body: JSON.stringify({ definition: collectionsAvgDef }),
      }
    );
    const badPreview = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          definition: "SELECT * FROM treasury_transactions",
        }),
      }
    );
    const beforeCount = (
      await admin
        .from("treasury_metrics")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tim.tenantId)
        .eq("status", "active")
    ).count;
    // another bad preview should not create rows
    await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          definition: {
            of: "monthly_totals",
            source: { type: "metric", ref: "missing_xyz" },
            op: "avg",
            window: { kind: "all" },
          },
        }),
      }
    );
    const afterCount = (
      await admin
        .from("treasury_metrics")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tim.tenantId)
        .eq("status", "active")
    ).count;

    record(
      3,
      "preview value + reject bad (no write)",
      okPreview.status === 200 &&
        typeof okPreview.json.value === "number" &&
        badPreview.status === 400 &&
        beforeCount === afterCount,
      `ok=${okPreview.status} bad=${badPreview.status} Δrows=${(afterCount ?? 0) - (beforeCount ?? 0)}`
    );
  }

  {
    const { status, json } = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${metricId}/compute`,
      { method: "POST" }
    );
    record(
      4,
      "compute endpoint",
      status === 200 && typeof json.value === "number" && !!json.computed_at,
      `status=${status} value=${json.value}`
    );
  }

  {
    const { data: before } = await admin
      .from("treasury_metrics")
      .select("version")
      .eq("id", metricId!)
      .single();
    const bad = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${metricId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          definition: {
            of: "monthly_totals",
            source: { type: "metric", ref: metricId },
            op: "avg",
            window: { kind: "all" },
          },
        }),
      }
    );
    // invalid ref by id string — use self name cycle
    const { data: row } = await admin
      .from("treasury_metrics")
      .select("name")
      .eq("id", metricId!)
      .single();
    const cyclic = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${metricId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          definition: {
            of: "monthly_totals",
            source: { type: "metric", ref: row!.name },
            op: "avg",
            window: { kind: "all" },
          },
        }),
      }
    );
    const good = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${metricId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          description: "updated desc",
          definition: {
            ...collectionsAvgDef,
            window: { kind: "trailing", months: 6 },
          },
        }),
      }
    );
    const metric = good.json.metric as { version?: number; description?: string };
    record(
      5,
      "PATCH revalidate + version bump",
      cyclic.status === 400 &&
        good.status === 200 &&
        (metric.version ?? 0) > (before?.version ?? 1) &&
        metric.description === "updated desc",
      `cyclic=${cyclic.status} good=${good.status} ver=${metric.version} (bad_ref=${bad.status})`
    );
  }

  {
    const name = `gate_b4_discard_${Date.now()}`;
    const created = await createMetric(admin, {
      tenantId: tim.tenantId,
      operatorUserId: tim.operatorId,
      scope: "client",
      clientId: timClient,
      name,
      description: "to discard",
      definition: collectionsAvgDef,
      source: "platform",
    });
    const del = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${created.id}`,
      { method: "DELETE" }
    );
    const { data: gone } = await admin
      .from("treasury_metrics")
      .select("status")
      .eq("id", created.id)
      .single();
    // name freed — recreate
    const again = await createMetric(admin, {
      tenantId: tim.tenantId,
      operatorUserId: tim.operatorId,
      scope: "client",
      clientId: timClient,
      name,
      description: "recreated",
      definition: collectionsAvgDef,
      source: "platform",
    });
    await admin
      .from("treasury_metrics")
      .update({ status: "discarded" })
      .eq("id", again.id);

    record(
      6,
      "DELETE soft-discard frees name",
      del.status === 200 && gone?.status === "discarded" && !!again.id,
      `del=${del.status} status=${gone?.status}`
    );
  }

  {
    // Ownership: client-scoped metric must not be reachable via sibling client URL
    const owned = await findMetricForClient(
      admin,
      tim.tenantId,
      otherTimClient,
      metricId!
    );
    const viaWrongUrl = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${otherTimClient}/metrics/${metricId}/compute`,
      { method: "POST" }
    );
    const anaBlocked = await opFetch(
      anaCookie,
      `/api/operator/treasury/clients/${timClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `leak_${Date.now()}`,
          description: "x",
          definition: collectionsAvgDef,
        }),
      }
    );
    const anaOnOwn = await opFetch(
      anaCookie,
      `/api/operator/treasury/clients/${anaClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `ana_ok_${Date.now()}`,
          description: "x",
          definition: collectionsAvgDef,
        }),
      }
    );
    if (anaOnOwn.status === 201) {
      const m = anaOnOwn.json.metric as { id: string };
      await admin
        .from("treasury_metrics")
        .update({ status: "discarded" })
        .eq("id", m.id);
    }

    record(
      7,
      "isolation + client ownership scoping",
      owned === null &&
        viaWrongUrl.status === 404 &&
        anaBlocked.status === 403 &&
        anaOnOwn.status === 201,
      `sibling_compute=${viaWrongUrl.status} ana_tim=${anaBlocked.status} ana_own=${anaOnOwn.status}`
    );
  }

  {
    process.env.MCP_DEV_TOKENS_ENABLED = "true";
    const out = (await mcpCall(tim.token, "define_metric", {
      scope: "client",
      client_id: timClient,
      name: `mcp_reg_${Date.now()}`,
      description: "regression",
      definition: collectionsAvgDef,
    })) as { id: string; source: string };
    const { data: row } = await admin
      .from("treasury_metrics")
      .select("source")
      .eq("id", out.id)
      .single();
    await admin
      .from("treasury_metrics")
      .update({ status: "discarded" })
      .eq("id", out.id);
    record(
      8,
      "MCP define_metric still source=mcp",
      row?.source === "mcp",
      `source=${row?.source}`
    );
  }

  {
    const writeSrc = readFileSync(join(ROOT, "lib/treasury/metrics-define.ts"), "utf8");
    const routeSrc = readFileSync(
      join(ROOT, "app/api/operator/treasury/clients/[clientId]/metrics/route.ts"),
      "utf8"
    );
    const mutates =
      /treasury_transactions/.test(writeSrc) ||
      /treasury_transactions/.test(routeSrc);
    record(9, "no transaction write path", !mutates, `mutates=${mutates}`);
  }

  // cleanup
  for (const id of [metricId, pctMetricId]) {
    if (id) {
      await admin
        .from("treasury_metrics")
        .update({ status: "discarded" })
        .eq("id", id);
    }
  }

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(10, "npm run build", true, "green");

  log("");
  log("=== Spec B4 gate: ALL PASS ===");
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B4 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
