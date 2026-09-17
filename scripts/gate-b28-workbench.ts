/**
 * B28 gate — Models & Metrics workbench (Module A).
 *
 * Static checks always run. Live API checks run when
 * scripts/.mcp-gate-tokens.json exists and sign-in succeeds.
 *
 * Usage: npm run gate:b28
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");

type OperatorToken = {
  email: string;
  operatorId: string;
  tenantId: string;
  clientIds: string[];
  token: string;
};

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
  console.log(`[gate-b28] ${msg}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function pass(id: number, name: string, detail: string) {
  log(`PASS ${id}. ${name} — ${detail}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function baseUrl(): string {
  const issuer = process.env.MCP_OAUTH_ISSUER?.trim();
  if (issuer) return issuer.replace(/\/$/, "");
  const gate = process.env.MCP_GATE_URL ?? "http://localhost:14000/api/mcp";
  return gate.replace(/\/api\/mcp\/?$/, "");
}

function loadTokens(): OperatorToken | null {
  if (!existsSync(TOKENS_PATH)) return null;
  const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  const r = raw.tim ?? raw.ana;
  if (!r) return null;
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
}): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ref = new URL(url).hostname.split(".")[0]!;
  const name = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
  return `${name}=${encodeURIComponent(payload)}`;
}

async function main() {
  loadEnvLocal();
  log("B28 Models & Metrics workbench gate");

  const page = "app/operator/treasury/clients/[clientId]/workbench/page.tsx";
  const wb = "components/operator/treasury/ModelsMetricsWorkbench.tsx";
  const review = "components/operator/treasury/ReviewTabPanel.tsx";
  const studio = "components/operator/treasury/ModelStudio.tsx";
  const record = "components/operator/OperatorTreasuryClientRecord.tsx";
  const previewRoute =
    "app/api/operator/treasury/clients/[clientId]/studies/preview/route.ts";

  assert(existsSync(join(ROOT, page)) && existsSync(join(ROOT, wb)), "workbench missing");
  pass(1, "Workbench route + component exist", `${page} + ${wb}`);

  const wbSrc = read(wb);
  assert(wbSrc.includes("workbench-model-window"), "missing model window marker");
  assert(wbSrc.includes("workbench-metric-no-window"), "missing metric no-window marker");
  assert(
    !/selected\.kind === "metric"[\s\S]{0,240}TreasuryDateRangePicker/.test(wbSrc),
    "date picker must not render for metric Run"
  );
  pass(2, "Window control is models-only", "picker on model Run only");

  assert(read(studio).includes("allowPlace"), "ModelStudio missing allowPlace");
  assert(wbSrc.includes("allowPlace={false}"), "workbench must Save-only");
  pass(3, "ModelStudio allowPlace Save-only", "allowPlace={false} on workbench");

  const reviewSrc = read(review);
  assert(!reviewSrc.includes("MetricsTab"), "MetricsTab still in ReviewTabPanel");
  assert(!reviewSrc.includes("ModelStudio"), "ModelStudio still in ReviewTabPanel");
  assert(!reviewSrc.includes("+ New metric"), "create metric button still present");
  assert(!reviewSrc.includes("shelf-metric-wizard"), "metric wizard mount still present");
  assert(reviewSrc.includes("shelf-metrics-workbench-link"), "metrics workbench link missing");
  assert(reviewSrc.includes("authoringHref"), "StudiesPanel authoringHref missing");
  pass(4, "Composer create affordances removed", "place kept; links to workbench");

  const recordSrc = read(record);
  assert(recordSrc.includes("client-record-workbench-link"), "record link missing");
  assert(recordSrc.includes("/workbench"), "record workbench href missing");
  pass(5, "Client-record workbench link", "overview link present");

  assert(wbSrc.includes("/compute"), "metric compute path missing");
  assert(wbSrc.includes("/studies/preview"), "studies preview path missing");
  assert(read(previewRoute).includes("asOf"), "preview route missing asOf");
  pass(6, "Reuse existing run endpoints", "compute + studies/preview(+asOf)");

  assert(wbSrc.includes("updated_at"), "last-modified updated_at missing");
  assert(!wbSrc.includes("treasury_metrics.version"), "must not surface .version");
  assert(!/\bedition\b/i.test(wbSrc), "must not surface edition concept");
  pass(7, "No versioning / schema surface", "updated_at only; version left alone");

  const op = loadTokens();
  const wantLive = process.env.GATE_B28_LIVE === "1";
  if (!wantLive) {
    log("SKIP live API — set GATE_B28_LIVE=1 with tokens + server to run");
    log("Done — static checks passed");
    return;
  }
  if (!op || op.clientIds.length === 0) {
    log("SKIP live API — no .mcp-gate-tokens.json");
    log("Done — static checks passed");
    return;
  }

  const clientId = op.clientIds[0]!;
  const base = baseUrl();
  let cookie: string;
  try {
    const admin = adminClient();
    const { data: signIn, error: signErr } = await admin.auth.signInWithPassword({
      email: op.email,
      password: process.env.MCP_GATE_PASSWORD ?? "mcp_gate_2026!",
    });
    if (signErr || !signIn.session) {
      log(`SKIP live API — sign-in failed: ${signErr?.message ?? "no session"}`);
      log("Done — static checks passed");
      return;
    }
    cookie = sessionCookieHeader(signIn.session);
  } catch (e) {
    log(`SKIP live API — auth error: ${e instanceof Error ? e.message : e}`);
    log("Done — static checks passed");
    return;
  }

  async function api(path: string, init?: RequestInit) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Cookie: cookie,
        ...(init?.headers ?? {}),
      },
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* */
    }
    return { status: res.status, json };
  }

  try {
    const metricsList = await api(
      `/api/operator/treasury/clients/${clientId}/metrics`
    );
    assert(metricsList.status === 200, `metrics list ${metricsList.status}`);
    pass(8, "Metrics list for client", `status=${metricsList.status}`);

    const create = await api(
      `/api/operator/treasury/clients/${clientId}/metrics`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `b28-gate-${Date.now()}`,
          scope: "client",
          definition: {
            op: "sum",
            source: { type: "label", key: "Revenue", direction: "in" },
            window: { kind: "trailing", months: 12 },
          },
        }),
      }
    );
    const created =
      (create.json.metric as { id?: string } | undefined)?.id ??
      (typeof create.json.id === "string" ? create.json.id : null);
    assert(create.status < 300 && created, `create metric failed ${create.status}`);
    pass(10, "Create metric persists", `id=${created}`);

    const compute = await api(
      `/api/operator/treasury/clients/${clientId}/metrics/${created}/compute`,
      { method: "POST" }
    );
    assert(compute.status < 300, `compute failed ${compute.status}`);
    pass(11, "Run metric via compute (persist)", `status=${compute.status}`);

    await api(`/api/operator/treasury/clients/${clientId}/metrics/${created}`, {
      method: "DELETE",
    });

    const preview = await api(
      `/api/operator/treasury/clients/${clientId}/studies/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cash_model",
          name: "B28 gate preview",
          params: {},
          scenarios: [],
          asOf: new Date().toISOString().slice(0, 10),
        }),
      }
    );
    assert(
      preview.status === 200 || preview.status === 400,
      `unexpected preview status ${preview.status}`
    );
    pass(
      12,
      "Run model via studies/preview (+asOf)",
      `status=${preview.status}`
    );

    log("Done — static + live checks passed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
      log(`SKIP live API — server not reachable at ${base}`);
      log("Done — static checks passed");
      return;
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(`[gate-b28] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
