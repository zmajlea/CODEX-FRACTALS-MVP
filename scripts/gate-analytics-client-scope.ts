/**
 * Spec B6 gate — client-scoped analytics (account optional).
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   Migration 20260820170000_client_scoped_analytics applied
 *   Dev server on MCP_GATE_URL host (default http://localhost:14000)
 *
 * Usage: npm run gate:analytics-client-scope
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database, Json } from "../lib/database.types";
import { loadMonthlyByCategoryFlat } from "../lib/treasury/load-monthly-by-category";
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
  console.log(`[gate-analytics-b6] ${msg}`);
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

function sumInflows(rows: Array<{ direction: string; total: number }>) {
  return rows
    .filter((r) => r.direction === "in")
    .reduce((a, r) => a + r.total, 0);
}

async function main() {
  loadEnvLocal();
  if (!existsSync(TOKENS_PATH)) {
    throw new Error("Missing scripts/.mcp-gate-tokens.json — run test:seed:mcp-testers");
  }

  const { tim, ana } = loadTokens();
  const timClient = tim.clientIds[0]!;
  const anaClient = ana.clientIds[0]!;
  const admin = adminClient();
  const timCookie = sessionCookieHeader(await signIn(tim.email));
  const cleanupIds: string[] = [];

  // Distinct ledger account_ids (csv:…), not treasury_accounts.id uuids
  const { data: acctRows } = await admin
    .from("treasury_transactions")
    .select("account_id")
    .eq("client_user_id", timClient)
    .eq("is_removed", false)
    .limit(5000);
  const accountIds = [
    ...new Set(
      (acctRows ?? [])
        .map((r) => r.account_id)
        .filter((a): a is string => Boolean(a))
    ),
  ].sort();

  // 1. CSV client: monthly non-empty, metric > 0, cash-model baseline
  {
    const flat = await loadMonthlyByCategoryFlat(admin, timClient, {
      accountId: null,
      from: "2000-01-01",
      to: "2099-12-31",
    });
    const topLabel =
      flat
        .filter((r) => r.direction === "in")
        .sort((a, b) => b.total - a.total)[0]?.label ?? "SELECTHEALTH";

    const created = await createMetric(admin, {
      tenantId: tim.tenantId,
      operatorUserId: tim.operatorId,
      scope: "client",
      clientId: timClient,
      name: `gate_b6_cat_${Date.now()}`,
      description: "csv client metric",
      definition: {
        of: "monthly_totals",
        source: { type: "category", key: topLabel, direction: "in" },
        op: "sum",
        window: { kind: "all" },
      },
      source: "platform",
    });
    cleanupIds.push(created.id);
    const computed = await computeMetricValue(admin, {
      id: created.id,
      tenant_id: tim.tenantId,
      client_user_id: timClient,
      definition: {
        of: "monthly_totals",
        source: { type: "category", key: topLabel, direction: "in" },
        op: "sum",
        window: { kind: "all" },
      } as unknown as Json,
    });
    const value =
      computed.kind === "value" ? computed.value : (computed.value ?? 0);
    const ledgerSum = flat
      .filter(
        (r) =>
          r.direction === "in" &&
          (r.label.toLowerCase() === topLabel.toLowerCase() ||
            r.label.toLowerCase().includes(topLabel.toLowerCase()))
      )
      .reduce((a, r) => a + r.total, 0);

    const cashGet = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/cash-model`
    );

    record(
      1,
      "CSV client monthly + metric >0 + cash baseline",
      flat.length > 0 &&
        value > 0 &&
        Math.abs(value - ledgerSum) < 0.01 &&
        cashGet.status === 200 &&
        !!(cashGet.json as { categorySeries?: unknown }).categorySeries,
      `monthly_rows=${flat.length} label=${topLabel} value=${value} ledger=${ledgerSum} cash=${cashGet.status}`
    );
  }

  // 2. Single-account parity: when filtered to the only account, equals client-wide
  //    (or for multi-account clients: pick one account and assert filter ⊆ all)
  {
    if (accountIds.length === 1) {
      const only = accountIds[0]!;
      const all = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: null,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      const one = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: only,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      const sumAll = sumInflows(all);
      const sumOne = sumInflows(one);
      record(
        2,
        "single-account parity (all === that account)",
        Math.abs(sumAll - sumOne) < 0.01 && all.length === one.length,
        `account=${only} all=${sumAll} one=${sumOne}`
      );
    } else {
      // Multi-account book: assert single-account filter is proper subset (parity N/A)
      const one = accountIds[0]!;
      const all = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: null,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      const filtered = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: one,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      const sumAll = sumInflows(all);
      const sumOne = sumInflows(filtered);
      record(
        2,
        "single-account filter ⊆ client-wide (multi-account book)",
        sumOne > 0 && sumOne < sumAll + 0.01 && sumAll > sumOne,
        `accounts=${accountIds.length} one=${sumOne} all=${sumAll}`
      );
    }
  }

  // 3. Multi-account: sum(A)+sum(B) === sum(all); account-sourced metric = one account
  {
    if (accountIds.length < 2) {
      record(
        3,
        "multi-account aggregate (skipped — need 2 accounts)",
        false,
        `accounts=${accountIds.length}`
      );
    } else {
      const a = accountIds[0]!;
      const b = accountIds[1]!;
      const rowsA = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: a,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      const rowsB = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: b,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      const rowsAll = await loadMonthlyByCategoryFlat(admin, timClient, {
        accountId: null,
        from: "2000-01-01",
        to: "2099-12-31",
      });
      // Sum ALL directions to catch double-count
      const tot = (rows: typeof rowsA) =>
        rows.reduce((s, r) => s + r.total, 0);
      const sumParts = tot(rowsA) + tot(rowsB);
      const sumAll = tot(rowsAll);
      // Other accounts beyond A+B may exist
      const rest = accountIds.slice(2);
      let restSum = 0;
      for (const id of rest) {
        restSum += tot(
          await loadMonthlyByCategoryFlat(admin, timClient, {
            accountId: id,
            from: "2000-01-01",
            to: "2099-12-31",
          })
        );
      }
      const okAgg = Math.abs(sumParts + restSum - sumAll) < 0.02;

      const m = await createMetric(admin, {
        tenantId: tim.tenantId,
        operatorUserId: tim.operatorId,
        scope: "client",
        clientId: timClient,
        name: `gate_b6_acct_${Date.now()}`,
        description: "account-sourced",
        definition: {
          of: "monthly_totals",
          source: { type: "account", key: a, direction: "any" },
          op: "sum",
          window: { kind: "all" },
        },
        source: "platform",
      });
      cleanupIds.push(m.id);
      const out = await computeMetricValue(admin, {
        id: m.id,
        tenant_id: tim.tenantId,
        client_user_id: timClient,
        definition: {
          of: "monthly_totals",
          source: { type: "account", key: a, direction: "any" },
          op: "sum",
          window: { kind: "all" },
        } as unknown as Json,
      });
      const metricVal = out.kind === "value" ? out.value : (out.value ?? 0);
      const okMetric = Math.abs(metricVal - tot(rowsA)) < 0.02;

      record(
        3,
        "multi-account no double-count + account source filter",
        okAgg && okMetric,
        `parts=${sumParts}+${restSum} all=${sumAll} metric=${metricVal} acctA=${tot(rowsA)}`
      );
    }
  }

  // 4. Isolation
  {
    const anaFlat = await loadMonthlyByCategoryFlat(admin, anaClient, {
      accountId: null,
      from: "2000-01-01",
      to: "2099-12-31",
    });
    const leak = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${anaClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `leak_b6_${Date.now()}`,
          description: "x",
          definition: {
            of: "monthly_totals",
            source: { type: "category", key: "x", direction: "in" },
            op: "sum",
            window: { kind: "all" },
          },
        }),
      }
    );
    record(
      4,
      "isolation cross-operator / grant",
      leak.status === 403 && anaFlat.length >= 0,
      `tim_on_ana=${leak.status} ana_monthly=${anaFlat.length}`
    );
  }

  // 5. Cash-model route without account_id
  {
    const get = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/cash-model`
    );
    const ensure = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/studies/ensure-primary-cash-model`,
      { method: "POST", body: JSON.stringify({}) }
    );
    record(
      5,
      "cash-model + ensure without account_id",
      get.status === 200 &&
        ensure.status === 200 &&
        !!(ensure.json.study as { id?: string } | undefined)?.id,
      `get=${get.status} ensure=${ensure.status}`
    );
  }

  // 6. No txn write path
  {
    const files = [
      "lib/treasury/load-monthly-by-category.ts",
      "lib/treasury/load-bucketed-by-category.ts",
      "lib/treasury/metrics-eval.ts",
      "lib/mcp/read-tools.ts",
      "lib/server/treasury-cash-model.ts",
      "app/api/operator/treasury/clients/[clientId]/cash-model/route.ts",
      "app/api/operator/treasury/clients/[clientId]/studies/ensure-primary-cash-model/route.ts",
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
    record(6, "no transaction write path", !mutates, `mutates=${mutates}`);
  }

  for (const id of cleanupIds) {
    await admin
      .from("treasury_metrics")
      .update({ status: "discarded" })
      .eq("id", id);
  }

  log("Re-running gate:mcp-b3, gate:metrics-ui, gate:metrics-b5…");
  execSync("npm run gate:mcp-b3", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, MCP_DEV_TOKENS_ENABLED: "true" },
  });
  execSync("npm run gate:metrics-ui", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, MCP_DEV_TOKENS_ENABLED: "true" },
  });
  execSync("npm run gate:metrics-b5", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, MCP_DEV_TOKENS_ENABLED: "true" },
  });
  record(7, "B3+B4+B5 no-regression", true, "all prior gates green");

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(8, "npm run build", true, "green");

  log("");
  log("=== Spec B6 gate: ALL PASS ===");
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B6 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
