/**
 * Spec B8 gate — metrics/analytics placement + print export (Path C).
 *
 * Prereqs: same as gate-analytics-boards-b7 (seed tokens + dev :14000).
 * Usage: npm run gate:b8
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";
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
  console.log(`[gate-b8] ${msg}`);
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

function loadTokens(): { tim: OperatorToken } {
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
      clientIds.map((id) => ({ email: "", id, displayName: id }));
    return {
      email: String(r.email),
      operatorId: String(r.operatorId),
      tenantId: String(r.tenantId),
      clientIds,
      clients,
      token: String(r.token),
    };
  }
  return { tim: norm(raw.tim!) };
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

async function opFetch(cookie: string, path: string, init: RequestInit = {}) {
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
    throw new Error("Missing scripts/.mcp-gate-tokens.json — run test:seed:mcp-testers");
  }

  // 1. Placement static checks
  {
    const proposalsApi = readFileSync(
      join(
        ROOT,
        "app/api/operator/treasury/clients/[clientId]/assistant-proposals/route.ts"
      ),
      "utf8"
    );
    const proposalsUi = readFileSync(
      join(
        ROOT,
        "components/operator/treasury/analytics/AssistantProposals.tsx"
      ),
      "utf8"
    );
    const saved = readFileSync(
      join(ROOT, "components/operator/treasury/analytics/SavedAnalytics.tsx"),
      "utf8"
    );
    const metricsTab = readFileSync(
      join(ROOT, "components/operator/treasury/analytics/MetricsTab.tsx"),
      "utf8"
    );
    const pdfLib = readFileSync(
      join(ROOT, "lib/treasury/analytics-pdf.ts"),
      "utf8"
    );

    const apiNoMetrics =
      !proposalsApi.includes('from("treasury_metrics")') &&
      !/metrics:\s*metrics\.data/.test(proposalsApi);
    const uiNoMetrics =
      !proposalsUi.includes("setMetrics") &&
      !proposalsUi.includes("metrics.map");
    const savedHasBoards =
      saved.includes("AnalyticsBoards") && !saved.includes("MetricsList");
    const metricsNoBoardsList =
      !metricsTab.includes("<AnalyticsBoards") &&
      metricsTab.includes("Save as Analytics") &&
      metricsTab.includes("tab=analytics&view=saved");
    const noPlaywright =
      !pdfLib.includes("playwright") && !pdfLib.includes("htmlToPdfBuffer");

    record(
      1,
      "placement: no metrics proposals; boards on Saved Analytics",
      apiNoMetrics &&
        uiNoMetrics &&
        savedHasBoards &&
        metricsNoBoardsList &&
        noPlaywright,
      `api=${apiNoMetrics} ui=${uiNoMetrics} saved=${savedHasBoards} metricsTab=${metricsNoBoardsList} noPw=${noPlaywright}`
    );
  }

  const { tim } = loadTokens();
  const timClient = tim.clients[0]!;
  const admin = adminClient();
  const timCookie = sessionCookieHeader(await signIn(tim.email));

  const createdMetric = await createMetric(admin, {
    tenantId: tim.tenantId,
    operatorUserId: tim.operatorId,
    scope: "client",
    clientId: timClient.id,
    name: `gate_b8_m_${Date.now()}`,
    description: "b8",
    definition: {
      of: "monthly_totals",
      source: { type: "category", key: "collections", direction: "in" },
      op: "sum",
      window: { kind: "all" },
    },
    source: "platform",
  });

  // 2. Create from Metrics path still works; board listable
  {
    const create = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics`,
      {
        method: "POST",
        body: JSON.stringify({
          title: "Gate B8 Board",
          metric_ids: [createdMetric.id],
        }),
      }
    );
    const board = create.json.board as { id?: string } | undefined;
    const list = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/analytics`
    );
    const boards = (list.json.boards as Array<{ id: string }>) ?? [];
    const ok =
      create.status === 201 &&
      !!board?.id &&
      boards.some((b) => b.id === board.id);

    record(
      2,
      "Save as Analytics create → listable on analytics API",
      ok,
      `create=${create.status} id=${board?.id} listed=${boards.length}`
    );

    // 3. Print export 200 HTML
    if (board?.id) {
      const exp = await fetch(
        `${baseUrl()}/api/operator/treasury/clients/${timClient.id}/analytics/${board.id}/export`,
        { headers: { Cookie: timCookie } }
      );
      const html = await exp.text();
      const ct = exp.headers.get("content-type") ?? "";
      const printOk =
        exp.status === 200 &&
        ct.includes("text/html") &&
        html.includes("Gate B8 Board") &&
        html.includes("Summit Treasury") &&
        html.includes("@media print") &&
        html.includes("window.print");
      record(
        3,
        "export print HTML 200",
        printOk,
        `status=${exp.status} ct=${ct} len=${html.length}`
      );

      await admin.from("treasury_analytics").delete().eq("id", board.id);
    } else {
      record(3, "export print HTML 200", false, "no board id");
    }
  }

  // Proposals API has no metrics field
  {
    const proposals = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient.id}/assistant-proposals`
    );
    const hasMetricsKey = Object.prototype.hasOwnProperty.call(
      proposals.json,
      "metrics"
    );
    record(
      4,
      "assistant-proposals API omits metrics",
      proposals.status === 200 && !hasMetricsKey,
      `status=${proposals.status} keys=${Object.keys(proposals.json).join(",")}`
    );
  }

  await admin
    .from("treasury_metrics")
    .update({ status: "discarded" })
    .eq("id", createdMetric.id);

  log("Re-running gate:analytics-boards-b7…");
  execSync("npm run gate:analytics-boards-b7", {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  record(5, "gate:analytics-boards-b7", true, "green");

  log("Re-running gate:metrics-b5…");
  execSync("npm run gate:metrics-b5", {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  record(6, "gate:metrics-b5", true, "green");

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(7, "npm run build", true, "green");

  log("");
  log("=== Spec B8 gate: ALL PASS ===");
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B8 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
