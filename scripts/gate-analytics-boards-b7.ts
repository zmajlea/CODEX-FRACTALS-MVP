/**
 * Spec B7 gate — analytics boards + client sharing (RLS isolation).
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   Migration 20260820180000_treasury_analytics applied
 *   Dev server on MCP_GATE_URL host (default http://localhost:14000)
 *
 * Usage: npm run gate:analytics-boards-b7
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database, Json } from "../lib/database.types";
import { computeMetricValue } from "../lib/treasury/metrics-eval";
import { createMetric } from "../lib/treasury/metrics-define";

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
  console.log(`[gate-analytics-b7] ${msg}`);
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
  const b64 = Buffer.from(payload, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const value = `base64-${b64}`;
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

/** Authenticated session client for RLS tests (never admin). */
function userClient(session: { access_token: string }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
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
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  loadEnvLocal();
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(
      "Missing scripts/.mcp-gate-tokens.json — run test:seed:mcp-testers"
    );
  }

  const { tim, ana } = loadTokens();
  const timClient = tim.clients[0]!;
  const otherTimClient = tim.clients[1]!;
  const anaClient = ana.clients[0]!;
  const admin = adminClient();
  const timCookie = sessionCookieHeader(await signIn(tim.email));
  const anaCookie = sessionCookieHeader(await signIn(ana.email));
  const clientASession = await signIn(timClient.email);
  const clientBSession = await signIn(otherTimClient.email);
  const clientA = userClient(clientASession);
  const clientB = userClient(clientBSession);

  const cleanupMetricIds: string[] = [];
  const cleanupBoardIds: string[] = [];

  // Seed 3 metrics for Tim's primary client
  const defs = [
    {
      name: `gate_b7_sum_${Date.now()}`,
      definition: {
        of: "monthly_totals",
        source: { type: "category", key: "collections", direction: "in" },
        op: "sum",
        window: { kind: "all" },
      },
    },
    {
      name: `gate_b7_avg_${Date.now()}`,
      definition: {
        of: "monthly_totals",
        source: { type: "category", key: "collections", direction: "in" },
        op: "avg",
        window: { kind: "all" },
      },
    },
    {
      name: `gate_b7_series_${Date.now()}`,
      definition: {
        of: "series_totals",
        source: { type: "category", key: "collections", direction: "in" },
        subdivision: "month",
        bucket_op: "sum",
        op: "sum",
        window: { kind: "trailing", months: 12 },
      },
    },
  ];

  const metricIds: string[] = [];
  for (const d of defs) {
    const created = await createMetric(admin, {
      tenantId: tim.tenantId,
      operatorUserId: tim.operatorId,
      scope: "client",
      clientId: timClient.id,
      name: d.name,
      description: "gate b7",
      definition: d.definition,
      source: "platform",
    });
    cleanupMetricIds.push(created.id);
    metricIds.push(created.id);
  }

  // 1. Create + assemble live values match compute_metric
  {
    const created = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics`,
      {
        method: "POST",
        body: JSON.stringify({
          title: "Gate B7 Board",
          description: "gate",
          metric_ids: metricIds,
        }),
      }
    );
    const board = created.json.board as { id: string } | undefined;
    if (!board?.id) {
      record(1, "create + assemble", false, `create=${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
      return;
    }
    cleanupBoardIds.push(board.id);

    const assembled = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${board.id}`
    );
    const items =
      (assembled.json.items as Array<{
        metric_id: string;
        computed?: {
          kind: string;
          value?: number;
          series?: { points?: unknown[]; summary?: { value?: number } };
        };
      }>) ?? [];

    let match = assembled.status === 200 && items.length === 3;
    const details: string[] = [];
    for (const mid of metricIds) {
      const row = items.find((i) => i.metric_id === mid);
      const { data: m } = await admin
        .from("treasury_metrics")
        .select("id, tenant_id, client_user_id, definition")
        .eq("id", mid)
        .single();
      if (!m || !row?.computed) {
        match = false;
        details.push(`${mid}:missing`);
        continue;
      }
      const computed = await computeMetricValue(admin, {
        id: m.id,
        tenant_id: m.tenant_id,
        client_user_id: m.client_user_id ?? timClient.id,
        definition: m.definition as Json,
      });
      let ok = false;
      if (computed.kind === "value") {
        ok =
          row.computed.kind === "value" &&
          Math.abs(Number(row.computed.value) - Number(computed.value)) < 0.01;
        details.push(
          `${mid.slice(0, 8)}:value exp=${computed.value} got=${row.computed.value}`
        );
      } else {
        const expPts = computed.series.points?.length ?? 0;
        const gotPts = row.computed.series?.points?.length ?? 0;
        const expSum =
          computed.value ?? computed.series.summary?.value ?? null;
        const gotSum =
          row.computed.value ?? row.computed.series?.summary?.value ?? null;
        ok =
          row.computed.kind === "analytics" &&
          expPts === gotPts &&
          ((expSum == null && gotSum == null) ||
            (expSum != null &&
              gotSum != null &&
              Math.abs(Number(gotSum) - Number(expSum)) < 0.01));
        details.push(
          `${mid.slice(0, 8)}:series pts=${gotPts}/${expPts} sum=${gotSum}/${expSum}`
        );
      }
      if (!ok) match = false;
    }

    record(
      1,
      "create + assemble matches compute",
      match,
      `board=${board.id} ${details.join("; ")}`
    );
  }

  const boardId = cleanupBoardIds[0]!;

  // 2. Edit/reorder persists; remove drops metric
  {
    const reordered = [metricIds[2]!, metricIds[0]!]; // drop middle
    const patched = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ metric_ids: reordered, title: "Gate B7 Reordered" }),
      }
    );
    const board = patched.json.board as {
      title?: string;
      items?: Array<{ metric_id: string }>;
    };
    const ids = (board?.items ?? []).map((i) => i.metric_id);
    record(
      2,
      "edit/reorder persists; remove drops",
      patched.status === 200 &&
        board?.title === "Gate B7 Reordered" &&
        ids.length === 2 &&
        ids[0] === reordered[0] &&
        ids[1] === reordered[1],
      `status=${patched.status} title=${board?.title} ids=${ids.join(",")}`
    );
  }

  // 3. Share gate — client session RLS before/after share/unshare
  {
    const before = await clientA
      .from("treasury_analytics")
      .select("id")
      .eq("id", boardId);
    const beforeList = await opFetch(
      sessionCookieHeader(clientASession),
      "/api/treasury/analytics"
    );

    const share = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}/share`,
      { method: "POST" }
    );

    const after = await clientA
      .from("treasury_analytics")
      .select("id, status")
      .eq("id", boardId);
    const afterList = await opFetch(
      sessionCookieHeader(clientASession),
      "/api/treasury/analytics"
    );
    const afterGet = await opFetch(
      sessionCookieHeader(clientASession),
      `/api/treasury/analytics/${boardId}`
    );

    const unshare = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}/unshare`,
      { method: "POST" }
    );
    const afterUnshare = await clientA
      .from("treasury_analytics")
      .select("id")
      .eq("id", boardId);

    // re-share for later isolation/PDF checks
    await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}/share`,
      { method: "POST" }
    );

    const beforeEmpty =
      (before.data?.length ?? 0) === 0 &&
      ((beforeList.json.boards as unknown[]) ?? []).length === 0;
    const afterGetOk =
      afterGet.status === 200 &&
      Array.isArray((afterGet.json as { items?: unknown }).items) &&
      !("transactions" in afterGet.json);
    const afterVisible =
      (after.data?.length ?? 0) === 1 &&
      ((afterList.json.boards as unknown[]) ?? []).some(
        (b) => (b as { id: string }).id === boardId
      ) &&
      afterGetOk;
    const unsharedHidden = (afterUnshare.data?.length ?? 0) === 0;

    record(
      3,
      "share gate (RLS before/after)",
      share.status === 200 &&
        unshare.status === 200 &&
        beforeEmpty &&
        afterVisible &&
        unsharedHidden,
      `before=${before.data?.length ?? 0} after=${after.data?.length ?? 0} unshare=${afterUnshare.data?.length ?? 0} get=${afterGet.status}`
    );
  }

  // 4. Isolation — operator B blocked; client B cannot see client A's shared board
  {
    const anaCreate = await opFetch(
      anaCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics`,
      {
        method: "POST",
        body: JSON.stringify({
          title: "Ana on Tim",
          metric_ids: [metricIds[0]!],
        }),
      }
    );
    const anaRead = await opFetch(
      anaCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}`
    );
    const anaShare = await opFetch(
      anaCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}/share`,
      { method: "POST" }
    );

    const foreignRls = await clientB
      .from("treasury_analytics")
      .select("id")
      .eq("id", boardId);
    const foreignApi = await opFetch(
      sessionCookieHeader(clientBSession),
      `/api/treasury/analytics/${boardId}`
    );

    record(
      4,
      "isolation operator + client RLS",
      anaCreate.status === 403 &&
        anaRead.status === 403 &&
        anaShare.status === 403 &&
        (foreignRls.data?.length ?? 0) === 0 &&
        (foreignApi.status === 404 || foreignApi.status === 403),
      `anaCreate=${anaCreate.status} anaRead=${anaRead.status} anaShare=${anaShare.status} foreignRls=${foreignRls.data?.length ?? 0} foreignApi=${foreignApi.status}`
    );
  }

  // 5. No raw ledger on client path; no treasury_transactions writes; print HTML export
  {
    const clientPayload = await opFetch(
      sessionCookieHeader(clientASession),
      `/api/treasury/analytics/${boardId}`
    );
    const payloadStr = JSON.stringify(clientPayload.json);
    const hasLedgerLeak =
      /treasury_transactions/.test(payloadStr) ||
      ("transactions" in clientPayload.json &&
        Array.isArray(
          (clientPayload.json as { transactions?: unknown }).transactions
        ));

    const files = [
      "lib/treasury/analytics-assemble.ts",
      "lib/treasury/analytics-pdf.ts",
      "app/api/operator/treasury/clients/[clientId]/analytics/route.ts",
      "app/api/operator/treasury/clients/[clientId]/analytics/[analyticsId]/route.ts",
      "app/api/treasury/analytics/route.ts",
      "app/api/treasury/analytics/[analyticsId]/route.ts",
    ];
    let mutates = false;
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      if (
        /\.from\(\s*["']treasury_transactions["']\s*\)[\s\S]{0,200}\.(insert|update|upsert|delete)\s*\(/.test(
          src
        )
      ) {
        mutates = true;
      }
    }

    const pdfRes = await fetch(
      `${baseUrl()}/api/operator/treasury/clients/${timClient.id}/analytics/${boardId}/export`,
      { headers: { Cookie: timCookie } }
    );
    const html = await pdfRes.text();
    const ct = pdfRes.headers.get("content-type") ?? "";
    const printOk =
      pdfRes.status === 200 &&
      ct.includes("text/html") &&
      html.includes("Summit Treasury") &&
      html.includes("@media print") &&
      html.includes("window.print");

    record(
      5,
      "no ledger leak / no txn writes / print HTML",
      clientPayload.status === 200 && !hasLedgerLeak && !mutates && printOk,
      `client=${clientPayload.status} leak=${hasLedgerLeak} mutates=${mutates} export=${pdfRes.status} ct=${ct}`
    );
  }

  // Cleanup
  for (const id of cleanupBoardIds) {
    await admin.from("treasury_analytics").delete().eq("id", id);
  }
  for (const id of cleanupMetricIds) {
    await admin
      .from("treasury_metrics")
      .update({ status: "discarded" })
      .eq("id", id);
  }

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(6, "npm run build", true, "green");

  log("");
  log("=== Spec B7 gate: ALL PASS ===");
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B7 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
