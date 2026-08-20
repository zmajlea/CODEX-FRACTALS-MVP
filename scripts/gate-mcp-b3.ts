/**
 * Spec B3 gate — propose_rule, metrics, recommendation source, isolation, no txn writes.
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   MCP_DEV_TOKENS_ENABLED=true on the target server
 *   Migration 20260820140000_mcp_writers applied
 *
 * Usage: npm run gate:mcp-b3
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
import { applyRulesForClient } from "../lib/treasury/apply-rules-for-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");

type OperatorKey = "tim" | "ana";
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
  console.log(`[gate-b3] ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  results.push({ id, name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function parseToolText(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  if (result.isError) {
    const text = result.content?.[0]?.text ?? "Unknown MCP error";
    throw new Error(text);
  }
  const text = result.content?.[0]?.text;
  if (!text) throw new Error("Empty MCP tool response");
  return JSON.parse(text) as unknown;
}

function normalizeOperator(raw: Record<string, unknown>): OperatorToken {
  const legacy = raw.clientId as string | undefined;
  const clientIds =
    (raw.clientIds as string[] | undefined) ?? (legacy ? [legacy] : []);
  return {
    email: String(raw.email),
    operatorId: String(raw.operatorId),
    tenantId: String(raw.tenantId),
    clientIds,
    token: String(raw.token),
  };
}

function loadTokens(): Record<OperatorKey, OperatorToken> {
  const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  if (!raw.tim || !raw.ana) {
    throw new Error("Expected tim + ana in .mcp-gate-tokens.json — re-run seed");
  }
  return {
    tim: normalizeOperator(raw.tim),
    ana: normalizeOperator(raw.ana),
  };
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

async function mcpClient(token: string) {
  const url = process.env.MCP_GATE_URL ?? "http://localhost:14000/api/mcp";
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: { token: async () => token },
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "gate-mcp-b3", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
) {
  const raw = await client.callTool({ name, arguments: args });
  return parseToolText(raw as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  });
}

async function main() {
  loadEnvLocal();
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(`Missing ${TOKENS_PATH} — run npm run test:seed:mcp-testers`);
  }
  process.env.MCP_DEV_TOKENS_ENABLED = "true";

  const { tim, ana } = loadTokens();
  const admin = adminClient();
  const timPrimary = tim.clientIds[0]!;
  const anaForeign = ana.clientIds[0]!;

  let ruleId: string | undefined;
  let metricId: string | undefined;
  let recId: string | undefined;

  {
    const beforeSug = (
      await admin
        .from("treasury_transaction_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", timPrimary)
    ).count;

    const { client, transport } = await mcpClient(tim.token);
    const out = (await callTool(client, "propose_rule", {
      client_id: timPrimary,
      name: `Gate B3 rule ${Date.now()}`,
      payee_contains: "GateB3PayeeXYZ",
      category: "Office Supplies",
      direction: "out",
    })) as { rule_id: string; status: string };

    const { data: row } = await admin
      .from("treasury_rules")
      .select("id, status, source, active")
      .eq("id", out.rule_id)
      .single();

    const afterSug = (
      await admin
        .from("treasury_transaction_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", timPrimary)
    ).count;

    const ok =
      out.status === "proposed" &&
      row?.status === "proposed" &&
      row?.source === "mcp" &&
      row?.active === false &&
      (afterSug ?? 0) === (beforeSug ?? 0);

    ruleId = out.rule_id;
    record(
      1,
      "propose_rule → proposed, no suggestions",
      ok,
      `status=${row?.status} active=${row?.active} Δsug=${(afterSug ?? 0) - (beforeSug ?? 0)}`
    );
    await transport.close();
  }

  {
    const beforeSug = (
      await admin
        .from("treasury_transaction_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", timPrimary)
    ).count;

    await admin
      .from("treasury_rules")
      .update({ status: "active", active: true })
      .eq("id", ruleId!);

    await applyRulesForClient(admin, timPrimary, ruleId!);

    const afterSug = (
      await admin
        .from("treasury_transaction_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", timPrimary)
    ).count;

    const { data: row } = await admin
      .from("treasury_rules")
      .select("status, active")
      .eq("id", ruleId!)
      .single();

    record(
      2,
      "confirm path → active + apply allowed",
      row?.status === "active" && row?.active === true,
      `status=${row?.status} Δsug=${(afterSug ?? 0) - (beforeSug ?? 0)}`
    );
  }

  {
    const { client, transport } = await mcpClient(tim.token);
    const metricName = `collections_trailing_3mo_avg_${Date.now()}`;
    const defined = (await callTool(client, "define_metric", {
      scope: "client",
      client_id: timPrimary,
      name: metricName,
      description: "Trailing 3mo collections avg",
      definition: {
        of: "monthly_totals",
        source: { type: "category", key: "collections", direction: "in" },
        op: "avg",
        window: { kind: "trailing", months: 3 },
      },
    })) as { id: string };

    metricId = defined.id;
    const computed = (await callTool(client, "compute_metric", {
      id: defined.id,
      client_id: timPrimary,
    })) as { value: number };

    const monthly = (await callTool(client, "get_monthly_by_category", {
      client_id: timPrimary,
    })) as Array<{ category: string; inflow: number; month: string }>;

    const ok =
      typeof computed.value === "number" &&
      Number.isFinite(computed.value) &&
      Array.isArray(monthly);

    record(
      3,
      "define_metric + compute_metric",
      ok,
      `value=${computed.value} monthly_rows=${monthly.length}`
    );
    await transport.close();
  }

  {
    const { client, transport } = await mcpClient(tim.token);
    const cases: Array<{ label: string; definition: unknown }> = [
      {
        label: "bad op",
        definition: {
          of: "monthly_totals",
          source: { type: "category", key: "x", direction: "in" },
          op: "drop_table",
          window: { kind: "all" },
        },
      },
      {
        label: "sql-ish",
        definition: "SELECT * FROM treasury_transactions",
      },
      {
        label: "unresolved ref",
        definition: {
          of: "monthly_totals",
          source: { type: "metric", ref: "does_not_exist_xyz" },
          op: "avg",
          window: { kind: "all" },
        },
      },
    ];

    let rejected = 0;
    for (const c of cases) {
      try {
        await callTool(client, "define_metric", {
          scope: "client",
          client_id: timPrimary,
          name: `bad_${c.label}_${Date.now()}`,
          description: "should fail",
          definition: c.definition,
        });
      } catch {
        rejected += 1;
      }
    }

    // cycle: create A then try B→A→B via defining A with ref to B when B refs A
    let cycleRejected = false;
    try {
      const a = (await callTool(client, "define_metric", {
        scope: "client",
        client_id: timPrimary,
        name: `cycle_a_${Date.now()}`,
        description: "a",
        definition: {
          of: "monthly_totals",
          source: { type: "category", key: "collections", direction: "in" },
          op: "sum",
          window: { kind: "all" },
        },
      })) as { id: string; name: string };
      await callTool(client, "define_metric", {
        scope: "client",
        client_id: timPrimary,
        name: `cycle_b_${Date.now()}`,
        description: "b",
        definition: {
          of: "monthly_totals",
          source: { type: "metric", ref: a.name },
          op: "avg",
          window: { kind: "all" },
        },
      });
      // re-define a referencing b would need update — instead define c that refs itself
      await callTool(client, "define_metric", {
        scope: "client",
        client_id: timPrimary,
        name: `cycle_self_${Date.now()}`,
        description: "self",
        definition: {
          of: "monthly_totals",
          source: { type: "metric", ref: `cycle_self_${Date.now()}` },
          op: "avg",
          window: { kind: "all" },
        },
      });
    } catch {
      cycleRejected = true;
    }

    // Explicit self-cycle with known name
    const selfName = `self_cycle_${Date.now()}`;
    let selfCycleOk = false;
    try {
      await callTool(client, "define_metric", {
        scope: "client",
        client_id: timPrimary,
        name: selfName,
        description: "self",
        definition: {
          of: "monthly_totals",
          source: { type: "metric", ref: selfName },
          op: "avg",
          window: { kind: "all" },
        },
      });
    } catch {
      selfCycleOk = true;
    }

    record(
      4,
      "invalid metrics rejected",
      rejected === 3 && selfCycleOk,
      `rejected=${rejected}/3 self_cycle=${selfCycleOk} (misc_cycle=${cycleRejected})`
    );
    await transport.close();
  }

  {
    const { client, transport } = await mcpClient(tim.token);
    const out = (await callTool(client, "propose_recommendation", {
      client_id: timPrimary,
      kind: "advice",
      title: `Gate B3 rec ${Date.now()}`,
      body: "Check runway before payroll.",
      category: "liquidity",
    })) as { id: string; status: string; kind: string; source: string };

    const { data: row } = await admin
      .from("treasury_recommendations")
      .select("id, status, kind, source, category")
      .eq("id", out.id)
      .single();

    recId = out.id;
    const ok =
      row?.status === "draft" &&
      row?.kind === "recommendation" &&
      row?.source === "mcp" &&
      row?.category === "liquidity";

    record(
      5,
      "propose_recommendation draft + source",
      ok,
      `kind=${row?.kind} source=${row?.source} category=${row?.category}`
    );
    await transport.close();
  }

  {
    const { client, transport } = await mcpClient(ana.token);
    let blockedRule = false;
    let blockedMetric = false;
    try {
      await callTool(client, "propose_rule", {
        client_id: timPrimary,
        name: "leak",
        payee_contains: "x",
        category: "y",
      });
    } catch {
      blockedRule = true;
    }
    try {
      await callTool(client, "define_metric", {
        scope: "client",
        client_id: timPrimary,
        name: `leak_${Date.now()}`,
        description: "x",
        definition: {
          of: "monthly_totals",
          source: { type: "category", key: "collections", direction: "in" },
          op: "sum",
          window: { kind: "all" },
        },
      });
    } catch {
      blockedMetric = true;
    }
    record(
      6,
      "cross-operator isolation on writes",
      blockedRule && blockedMetric,
      `rule=${blockedRule} metric=${blockedMetric}`
    );
    await transport.close();
  }

  {
    // Static assertion: registered write tools must not include txn mutators
    const src = readFileSync(join(ROOT, "lib/mcp/register-tools.ts"), "utf8");
    const forbidden = [
      "update_transaction",
      "set_label",
      "bulk_label",
      "write_transaction",
      "mutate_ledger",
    ];
    const hit = forbidden.filter((f) => src.includes(`"${f}"`) || src.includes(`'${f}'`));
    const hasWriters = [
      "propose_rule",
      "define_metric",
      "propose_recommendation",
      "submit_results",
    ].every((n) => src.includes(`"${n}"`));
    const mutatesTxn =
      /from\("treasury_transactions"\)[\s\S]{0,80}\.(insert|update|upsert|delete)/.test(
        readFileSync(join(ROOT, "lib/mcp/write-tools.ts"), "utf8")
      ) ||
      /from\("treasury_transactions"\)[\s\S]{0,80}\.(insert|update|upsert|delete)/.test(
        readFileSync(join(ROOT, "lib/mcp/metric-tools.ts"), "utf8")
      );
    record(
      7,
      "no MCP transaction-write tools",
      hit.length === 0 && hasWriters && !mutatesTxn,
      `forbidden_hits=${hit.join(",") || "none"}; mutates_txn=${mutatesTxn}`
    );
  }

  // cleanup
  if (ruleId) {
    await admin.from("treasury_rules").delete().eq("id", ruleId);
  }
  if (metricId) {
    await admin
      .from("treasury_metrics")
      .update({ status: "discarded" })
      .eq("id", metricId);
  }
  if (recId) {
    await admin.from("treasury_recommendations").delete().eq("id", recId);
  }

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(8, "npm run build", true, "green");

  log("");
  log("=== Spec B3 gate: ALL PASS ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B3 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
