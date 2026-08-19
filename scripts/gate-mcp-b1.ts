/**
 * Spec B1 gate — MCP server auth, scope, read/write, audit, cross-operator isolation.
 *
 * Prereqs:
 *   npm run db:apply  (migration 20260819120000_mcp_b1.sql)
 *   MCP_DEV_TOKENS_ENABLED=true on the target server
 *   npx tsx scripts/seed-mcp-three-testers.ts
 *   Dev server or deploy at MCP_GATE_URL (default http://localhost:3000/api/mcp)
 *
 * Usage: npx tsx scripts/gate-mcp-b1.ts
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";
import type { SummitResultsV1 } from "../lib/mcp/results-schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");

type TesterKey = "leander" | "ana" | "tim";
type TokenBundle = Record<
  TesterKey,
  { email: string; operatorId: string; tenantId: string; clientId: string; token: string }
>;

const results: Array<{ id: number; name: string; ok: boolean; detail: string }> = [];

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
  console.log(`[gate-b1] ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  results.push({ id, name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function parseToolText(result: { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  if (result.isError) {
    const text = result.content?.[0]?.text ?? "Unknown MCP error";
    throw new Error(text);
  }
  const text = result.content?.[0]?.text;
  if (!text) throw new Error("Empty MCP tool response");
  return JSON.parse(text) as unknown;
}

async function mcpClient(token: string | null) {
  const url = process.env.MCP_GATE_URL ?? "http://localhost:3000/api/mcp";
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: token ? { token: async () => token } : undefined,
    requestInit: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
  });
  const client = new Client({ name: "gate-mcp-b1", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
) {
  const raw = await client.callTool({ name, arguments: args });
  return parseToolText(raw as { content?: Array<{ type: string; text?: string }>; isError?: boolean });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

function buildValidResults(opening: number, exportId: string): SummitResultsV1 {
  const beginning = opening;
  const net = -5000;
  const ending = beginning + net;
  return {
    schema_version: "summit.results/v1",
    export_id: exportId,
    as_of: new Date().toISOString().slice(0, 10),
    headline: "Gate B1 valid external model",
    kpis: [],
    narrative: [{ body: "Automated gate submission." }],
    scenarios: [
      {
        id: "base",
        name: "Base",
        timeline: [
          {
            month: "2026-08",
            beginning,
            net,
            ending,
          },
        ],
        breach_month: null,
        runway_months: 12,
      },
    ],
    recommendations: [],
    actuals_check: [],
    opening_balance: opening,
  };
}

function buildBrokenResults(opening: number): SummitResultsV1 {
  const r = buildValidResults(opening, `gate-broken-${Date.now()}`);
  r.scenarios[0]!.timeline[0]!.ending = r.scenarios[0]!.timeline[0]!.beginning + 999;
  return r;
}

async function main() {
  loadEnvLocal();
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(`Missing ${TOKENS_PATH} — run seed-mcp-three-testers first`);
  }
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as TokenBundle;
  const leander = tokens.leander;
  const ana = tokens.ana;

  // 1. Auth — no token → 401
  try {
    const { client, transport } = await mcpClient(null);
    await client.listTools();
    record(1, "Auth without token", false, "Expected 401 but listTools succeeded");
    await transport.close();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ok =
      /401|unauthorized|Unauthorized|invalid_token|No authorization/i.test(msg);
    record(1, "Auth without token", ok, ok ? "401 as expected" : msg);
  }

  // 1b. Valid token → tools list
  {
    const { client, transport } = await mcpClient(leander.token);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    record(
      2,
      "Auth with valid token",
      names.includes("list_clients") && names.includes("submit_results"),
      `${names.length} tools including list_clients + submit_results`
    );
    await transport.close();
  }

  // 2. Scope — list_clients only own client
  {
    const { client, transport } = await mcpClient(leander.token);
    const listed = (await callTool(client, "list_clients")) as Array<{ id: string }>;
    const ids = listed.map((c) => c.id);
    const ok =
      ids.length === 1 &&
      ids[0] === leander.clientId &&
      !ids.includes(ana.clientId);
    record(
      3,
      "list_clients scoped",
      ok,
      `Leander sees ${ids.length} client(s): ${ids.join(", ")}`
    );
    await transport.close();
  }

  // 2b. Non-granted client → error
  {
    const { client, transport } = await mcpClient(leander.token);
    let denied = false;
    try {
      await callTool(client, "get_transactions", { client_id: ana.clientId });
    } catch (e) {
      denied = /grant|No treasury/i.test(String(e));
    }
    record(
      4,
      "get_transactions non-granted client",
      denied,
      denied ? "MCP error (not data)" : "Expected grant error"
    );
    await transport.close();
  }

  // 3. Read — sign convention + monthly reconcile
  {
    const { client, transport } = await mcpClient(leander.token);
    const txns = (await callTool(client, "get_transactions", {
      client_id: leander.clientId,
      status: "all",
    })) as Array<{ amount: number; direction: string }>;
    const monthly = (await callTool(client, "get_monthly_by_category", {
      client_id: leander.clientId,
    })) as Array<{ month: string; inflow: number; outflow: number; net: number }>;

    const hasPositiveIn =
      txns.length === 0 ||
      txns.some((t) => t.direction === "in" && t.amount > 0) ||
      txns.every((t) => (t.direction === "in" ? t.amount >= 0 : t.amount <= 0));

    let reconcileOk = true;
    let reconcileDetail = "no transactions";
    if (txns.length > 0 && monthly.length > 0) {
      const txnByMonth = new Map<string, number>();
      for (const t of txns as Array<{ amount: number; date: string }>) {
        const m = t.date.slice(0, 7);
        txnByMonth.set(m, (txnByMonth.get(m) ?? 0) + t.amount);
      }
      const monthlyByMonth = new Map<string, number>();
      for (const r of monthly) {
        const m = r.month.slice(0, 7);
        monthlyByMonth.set(m, (monthlyByMonth.get(m) ?? 0) + r.net);
      }
      const sharedMonths = [...txnByMonth.keys()].filter((m) =>
        monthlyByMonth.has(m)
      );
      reconcileOk =
        sharedMonths.length === 0 ||
        sharedMonths.every((m) => {
          const a = txnByMonth.get(m)!;
          const b = monthlyByMonth.get(m)!;
          const base = Math.max(Math.abs(a), Math.abs(b), 1);
          return Math.abs(a - b) / base <= 0.05;
        });
      reconcileDetail = `${sharedMonths.length} shared month(s) in txn sample vs monthly`;
    } else if (monthly.length === 0) {
      reconcileDetail = "no monthly rows (optional seed book)";
    }

    record(
      5,
      "get_transactions sign (money-in positive)",
      hasPositiveIn,
      `${txns.length} rows sampled`
    );
    record(6, "monthly vs transactions reconcile", reconcileOk, reconcileDetail);
    await transport.close();
  }

  const admin = adminClient();
  const auditBefore = (
    await admin
      .from("mcp_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("operator_user_id", leander.operatorId)
  ).count;

  // 4. Write valid
  let studyId: string | null = null;
  {
    const { client, transport } = await mcpClient(leander.token);
    const meta = (await callTool(client, "get_client", {
      client_id: leander.clientId,
    })) as { opening_balance: number | null };
    const opening = meta.opening_balance ?? 100_000;
    const payload = buildValidResults(opening, `gate-valid-${Date.now()}`);
    const out = (await callTool(client, "submit_results", {
      client_id: leander.clientId,
      results: payload,
    })) as { study_id: string; message: string };

    studyId = out.study_id;
    const { data: row } = await admin
      .from("treasury_studies")
      .select("type, status, source")
      .eq("id", studyId)
      .maybeSingle();

    const ok =
      Boolean(studyId) &&
      row?.type === "external_model" &&
      row?.status === "pending" &&
      row?.source === "mcp";
    record(
      7,
      "submit_results valid → pending study",
      ok,
      `study_id=${studyId} type=${row?.type} status=${row?.status}`
    );
    await transport.close();
  }

  // 5. Write invalid
  {
    const { client, transport } = await mcpClient(leander.token);
    const meta = (await callTool(client, "get_client", {
      client_id: leander.clientId,
    })) as { opening_balance: number | null };
    const opening = meta.opening_balance ?? 100_000;
    let rejected = false;
    try {
      await callTool(client, "submit_results", {
        client_id: leander.clientId,
        results: buildBrokenResults(opening),
      });
    } catch (e) {
      rejected = /Validation failed|arithmetic|ending/i.test(String(e));
    }
    record(
      8,
      "submit_results invalid rejected",
      rejected,
      rejected ? "Field-level validation error" : "Expected rejection"
    );
    await transport.close();
  }

  // 6. Reconcile warn
  {
    const { client, transport } = await mcpClient(leander.token);
    const monthly = (await callTool(client, "get_monthly_by_category", {
      client_id: leander.clientId,
    })) as Array<{ month: string; category: string; inflow: number; outflow: number; net: number }>;

    const sample = monthly[0];
    const meta = (await callTool(client, "get_client", {
      client_id: leander.clientId,
    })) as { opening_balance: number | null };
    const opening = meta.opening_balance ?? 100_000;
    const payload = buildValidResults(opening, `gate-warn-${Date.now()}`);
    if (sample) {
      payload.actuals_check = [
        {
          month: sample.month,
          category: sample.category,
          inflow: sample.inflow,
          outflow: sample.outflow,
          net: sample.net + (Math.abs(sample.net) + 1000) * 0.5,
        },
      ];
    } else {
      payload.actuals_check = [
        {
          month: "2026-01",
          category: "GateSyntheticCategory",
          inflow: 10_000,
          outflow: 8_000,
          net: 50_000,
        },
      ];
    }
    const out = (await callTool(client, "submit_results", {
      client_id: leander.clientId,
      results: payload,
    })) as { study_id: string; validation: { warnings: string[] } };

    const { data: row } = await admin
      .from("treasury_studies")
      .select("derived_snapshot")
      .eq("id", out.study_id)
      .maybeSingle();

    const snap = row?.derived_snapshot as { validationReport?: { warnings?: string[] } };
    const warnings = out.validation?.warnings ?? snap?.validationReport?.warnings ?? [];
    const ok = warnings.some((w) => /off|%|ledger|aggregate/i.test(w));
    record(
      9,
      "reconcile warn stored",
      ok,
      warnings.slice(0, 2).join("; ") || "no warnings"
    );

    await admin.from("treasury_studies").delete().eq("id", out.study_id);
    if (studyId) await admin.from("treasury_studies").delete().eq("id", studyId);
    await transport.close();
  }

  // 7. Audit rows
  {
    const auditAfter = (
      await admin
        .from("mcp_audit_log")
        .select("id", { count: "exact", head: true })
        .eq("operator_user_id", leander.operatorId)
    ).count;
    const delta = (auditAfter ?? 0) - (auditBefore ?? 0);
    record(
      10,
      "mcp_audit_log rows",
      delta >= 5,
      `+${delta} audit rows for leander`
    );
  }

  // 8. Cross-operator isolation (both directions)
  {
    const { client, transport } = await mcpClient(leander.token);
    let aBlocked = false;
    try {
      await callTool(client, "get_client", { client_id: ana.clientId });
    } catch {
      aBlocked = true;
    }
    await transport.close();

    const { client: c2, transport: t2 } = await mcpClient(ana.token);
    let bBlocked = false;
    try {
      await callTool(c2, "get_client", { client_id: leander.clientId });
    } catch {
      bBlocked = true;
    }
    await t2.close();

    record(
      11,
      "cross-operator isolation A→B",
      aBlocked,
      aBlocked ? "denied" : "leaked data"
    );
    record(
      12,
      "cross-operator isolation B→A",
      bBlocked,
      bBlocked ? "denied" : "leaked data"
    );
  }

  // 9. Build
  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(13, "npm run build", true, "green");

  log("");
  log("=== Spec B1 gate: ALL PASS ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B1 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
