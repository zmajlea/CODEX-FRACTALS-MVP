/**
 * Spec B5 gate — value back-compat, analytics envelope, refs/breaches, point-cap,
 * isolation on compute + recalculate, no txn write path.
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   Migration 20260820160000_metrics_kind + 20260902180000_comparison_metric_kind applied
 *   Dev server on MCP_GATE_URL host (default http://localhost:14000)
 *   gate:mcp-b3 + gate:metrics-ui still pass
 *
 * Usage: npm run gate:metrics-b5
 */
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "../lib/database.types";
import {
  estimateBucketCount,
  kindFromDefinition,
  validateMetricDefinition,
} from "../lib/mcp/metrics-schema";
import { createMetric } from "../lib/treasury/metrics-define";
import {
  computeMetricValue,
  findMetricForClient,
  previewMetricValue,
} from "../lib/treasury/metrics-eval";

const R1_CLIENT1_EMAIL = "r1_gate_client_1@codexone.test";
const R1_OPERATOR_EMAIL = "r1_gate_operator@codexone.test";

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
  console.log(`[gate-metrics-b5] ${msg}`);
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

const valueDef = {
  of: "monthly_totals" as const,
  source: { type: "category" as const, key: "collections", direction: "in" as const },
  op: "avg" as const,
  window: { kind: "trailing" as const, months: 3 },
};

async function resolveUserId(
  admin: ReturnType<typeof adminClient>,
  email: string
): Promise<string> {
  const { data, error } = await admin
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (error || !data) throw new Error(`user ${email}: ${error?.message ?? "missing"}`);
  return data.id;
}

function comparisonYearDef(key = "Tax") {
  return {
    of: "series_compare" as const,
    source: { type: "category" as const, key, direction: "out" as const },
    subdivision: "month" as const,
    bucket_op: "sum" as const,
    window: { kind: "all" as const },
    compare: { by: "year" as const, last_n_years: 3 },
  };
}

function comparisonCategoryDef() {
  return {
    of: "series_compare" as const,
    source: { type: "category" as const, key: "Tax", direction: "out" as const },
    subdivision: "month" as const,
    bucket_op: "sum" as const,
    window: { kind: "trailing" as const, months: 12 },
    compare: { by: "category" as const, keys: ["Tax", "Payroll"] },
  };
}

function analyticsDef(maxCap: number) {
  return {
    of: "series_totals" as const,
    source: { type: "category" as const, key: "collections", direction: "in" as const },
    subdivision: "day" as const,
    bucket_op: "sum" as const,
    window: { kind: "trailing" as const, months: 1 },
    op: "sum" as const,
    reference_lines: [
      {
        id: "avg",
        label: "Daily average",
        kind: "avg" as const,
        stat: "avg" as const,
        breach: "none" as const,
      },
      {
        id: "cap",
        label: "Max expected",
        kind: "max" as const,
        value: maxCap,
        breach: "flag" as const,
      },
    ],
    chart_hint: "column" as const,
  };
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
  const anaCookie = sessionCookieHeader(await signIn(ana.email));

  const cleanupIds: string[] = [];

  // 1. Value back-compat — same scalar shape as B4
  {
    const name = `gate_b5_value_${Date.now()}`;
    const created = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "value back-compat",
          definition: valueDef,
          scope: "client",
        }),
      }
    );
    const metric = created.json.metric as {
      id?: string;
      kind?: string;
      computed_value?: { value?: number; v?: number };
    };
    cleanupIds.push(metric?.id ?? "");
    const preview = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/preview`,
      { method: "POST", body: JSON.stringify({ definition: valueDef }) }
    );
    const compute = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${metric?.id}/compute`,
      { method: "POST" }
    );
    const ok =
      created.status === 201 &&
      metric?.kind === "value" &&
      typeof metric.computed_value?.value === "number" &&
      metric.computed_value?.v === undefined &&
      preview.status === 200 &&
      typeof preview.json.value === "number" &&
      (preview.json as { v?: number }).v === undefined &&
      compute.status === 200 &&
      typeof compute.json.value === "number" &&
      (compute.json as { v?: number }).v === undefined;
    record(
      1,
      "value metric byte-identical scalar",
      ok,
      `kind=${metric?.kind} create=${created.status} preview=${preview.status} compute=${compute.status}`
    );
  }

  // 2. Analytics series — envelope, 0-points, partial edges
  let analyticsId = "";
  {
    const def = analyticsDef(1e15); // no breaches yet
    const name = `gate_b5_analytics_${Date.now()}`;
    const created = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "daily income",
          definition: def,
          scope: "client",
        }),
      }
    );
    const metric = created.json.metric as {
      id?: string;
      kind?: string;
      computed_value?: {
        v?: number;
        points?: Array<{
          bucket_start: string;
          value: number;
          partial?: true;
        }>;
        window?: { start: string; end: string };
        summary?: { value: number };
      };
    };
    analyticsId = metric?.id ?? "";
    cleanupIds.push(analyticsId);

    const compute = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${analyticsId}/compute`,
      { method: "POST" }
    );
    const series = compute.json as {
      v?: number;
      points?: Array<{ value: number; partial?: true }>;
      window?: { start: string; end: string };
    };
    const points = series.points ?? [];
    const hasZero = points.some((p) => p.value === 0);
    const hasPartial = points.some((p) => p.partial === true);
    // For day+trailing-1mo starting on month boundary, partial may be false —
    // week/quarter edges are the main partial case. Force week check below if needed.
    const ok =
      created.status === 201 &&
      metric?.kind === "analytics" &&
      compute.status === 200 &&
      series.v === 2 &&
      points.length > 0 &&
      hasZero;
    record(
      2,
      "analytics envelope + 0-points",
      ok,
      `kind=${metric?.kind} v=${series.v} points=${points.length} zeros=${hasZero} partial=${hasPartial}`
    );
  }

  // 2b. Partial flag on week subdivision at window edge
  {
    const weekDef = {
      of: "series_totals",
      source: { type: "category", key: "collections", direction: "in" },
      subdivision: "week",
      bucket_op: "sum",
      window: { kind: "trailing", months: 1 },
      chart_hint: "column",
    };
    const preview = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/preview`,
      { method: "POST", body: JSON.stringify({ definition: weekDef }) }
    );
    const points =
      (preview.json.points as Array<{ partial?: true }> | undefined) ?? [];
    const hasPartial = points.some((p) => p.partial === true);
    record(
      3,
      "window-edge partial buckets (week)",
      preview.status === 200 && points.length > 0 && hasPartial,
      `status=${preview.status} points=${points.length} partial=${hasPartial}`
    );
  }

  // 4. Reference lines + breaches
  {
    // Use a tiny cap so some days (or zeros) breach max — zeros don't breach max.
    // Cap at -1 so every non-negative day breaches; or use min with flag.
    // Better: set max cap to -0.01 so all values >= 0 breach.
    const def = analyticsDef(-0.01);
    const name = `gate_b5_breach_${Date.now()}`;
    const created = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "breach test",
          definition: def,
          scope: "client",
        }),
      }
    );
    const id = (created.json.metric as { id?: string })?.id ?? "";
    cleanupIds.push(id);
    const compute = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/${id}/compute`,
      { method: "POST" }
    );
    const series = compute.json as {
      reference_lines?: Array<{
        id: string;
        value: number;
        computed: boolean;
      }>;
      points?: Array<{ value: number; breaches?: string[] }>;
      summary?: { breach_count?: number };
    };
    const avgLine = series.reference_lines?.find((r) => r.id === "avg");
    const capLine = series.reference_lines?.find((r) => r.id === "cap");
    const breached = (series.points ?? []).filter((p) =>
      p.breaches?.includes("cap")
    );
    const breachCount = series.summary?.breach_count ?? 0;
    const points = series.points ?? [];
    const avgExpected =
      points.length > 0
        ? points.reduce((a, p) => a + p.value, 0) / points.length
        : 0;
    const avgOk =
      !!avgLine?.computed &&
      Math.abs((avgLine?.value ?? 0) - avgExpected) < 1e-6;
    const ok =
      compute.status === 200 &&
      avgOk &&
      capLine?.computed === false &&
      capLine?.value === -0.01 &&
      breached.length === breachCount &&
      breachCount > 0;
    record(
      4,
      "reference lines + breach flags/count",
      ok,
      `avgOk=${avgOk} cap=${capLine?.value} breaches=${breached.length} count=${breachCount}`
    );
  }

  // 5. Point cap rejects day+all
  {
    const bad = validateMetricDefinition({
      of: "series_totals",
      source: { type: "category", key: "x", direction: "in" },
      subdivision: "day",
      window: { kind: "all" },
      bucket_op: "sum",
    });
    const est = estimateBucketCount("day", { kind: "all" });
    const viaApi = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          definition: {
            of: "series_totals",
            source: { type: "category", key: "x", direction: "in" },
            subdivision: "day",
            window: { kind: "all" },
          },
        }),
      }
    );
    record(
      5,
      "point cap rejects day+all",
      !bad.ok && est > 400 && viaApi.status === 400,
      `est=${est} schemaOk=${bad.ok} api=${viaApi.status}`
    );
  }

  // 6. No-SQL / whitelist
  {
    const sql = validateMetricDefinition("SELECT * FROM treasury_transactions");
    const unknown = validateMetricDefinition({
      of: "series_totals",
      source: { type: "category", key: "x" },
      subdivision: "day",
      window: { kind: "trailing", months: 1 },
      bucket_op: "median" as unknown as "sum",
    });
    record(
      6,
      "no-SQL / whitelist",
      !sql.ok && !unknown.ok,
      `sql=${sql.ok} unknownOp=${unknown.ok}`
    );
  }

  // 7. Isolation on compute + recalculate
  {
    const otherTimClient = tim.clientIds[1]!;
    const owned = await findMetricForClient(
      admin,
      tim.tenantId,
      otherTimClient,
      analyticsId
    );
    const viaWrongUrl = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${otherTimClient}/metrics/${analyticsId}/compute`,
      { method: "POST" }
    );
    const anaRecalcOnTim = await opFetch(
      anaCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/recalculate`,
      { method: "POST" }
    );
    const timRecalc = await opFetch(
      timCookie,
      `/api/operator/treasury/clients/${timClient}/metrics/recalculate`,
      { method: "POST" }
    );
    const resultsArr =
      (timRecalc.json.results as Array<{ id: string; ok: boolean }>) ?? [];
    record(
      7,
      "isolation compute + recalculate",
      owned === null &&
        viaWrongUrl.status === 404 &&
        anaRecalcOnTim.status === 403 &&
        timRecalc.status === 200 &&
        resultsArr.some((r) => r.id === analyticsId && r.ok),
      `wrong_compute=${viaWrongUrl.status} owned=${owned === null} ana_recalc=${anaRecalcOnTim.status} recalc=${timRecalc.status}`
    );
  }

  // 8. No treasury_transactions write path
  {
    const files = [
      "lib/treasury/metrics-define.ts",
      "lib/treasury/metrics-eval.ts",
      "lib/treasury/load-bucketed-by-category.ts",
      "app/api/operator/treasury/clients/[clientId]/metrics/route.ts",
      "app/api/operator/treasury/clients/[clientId]/metrics/recalculate/route.ts",
      "app/api/operator/treasury/clients/[clientId]/metrics/[metricId]/compute/route.ts",
    ];
    let mutates = false;
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      // allow .from("treasury_transactions").select — reject .insert/.update/.upsert/.delete
      if (
        /\.from\(\s*["']treasury_transactions["']\s*\)[\s\S]{0,200}\.(insert|update|upsert|delete)\s*\(/.test(
          src
        )
      ) {
        mutates = true;
      }
    }
    record(8, "no transaction write path", !mutates, `mutates=${mutates}`);
  }

  // 10. kindFromDefinition trap — series_compare + subdivision must not classify as analytics
  {
    const def = comparisonYearDef("Tax");
    const kind = kindFromDefinition(def);
    const legacyTrap = def.subdivision ? "analytics" : "value";
    record(
      10,
      "kindFromDefinition series_compare not analytics trap",
      kind === "comparison" && kind !== legacyTrap,
      `kind=${kind} legacyTrap=${legacyTrap}`
    );
  }

  const r1ClientId = await resolveUserId(admin, R1_CLIENT1_EMAIL);
  const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
  const { data: r1Grant } = await admin
    .from("client_module_access")
    .select("distributor_tenant_id")
    .eq("client_user_id", r1ClientId)
    .limit(1)
    .maybeSingle();
  const r1TenantId = r1Grant?.distributor_tenant_id;

  // 11. Comparison by year — v:3 envelope, aligned axis
  {
    if (!r1TenantId) {
      record(11, "comparison by year v:3 envelope", false, "missing r1 tenant");
    } else {
      const out = await previewMetricValue(
        admin,
        r1TenantId,
        r1ClientId,
        comparisonYearDef("Tax")
      );
      const cmp =
        out.ok && out.kind === "comparison" ? out.comparison : null;
      const ok =
        out.ok &&
        out.kind === "comparison" &&
        cmp?.v === 3 &&
        cmp.kind === "comparison" &&
        (cmp.groups?.length ?? 0) === 3 &&
        (cmp.axis?.labels?.length ?? 0) === 12;
      record(
        11,
        "comparison by year v:3 envelope",
        ok,
        `kind=${out.ok ? out.kind : "?"} v=${cmp?.v} groups=${cmp?.groups?.length} axis=${cmp?.axis?.labels?.length}`
      );
    }
  }

  // 12. Comparison by category — two groups over window
  {
    if (!r1TenantId) {
      record(12, "comparison by category two groups", false, "missing r1 tenant");
    } else {
      const out = await previewMetricValue(
        admin,
        r1TenantId,
        r1ClientId,
        comparisonCategoryDef()
      );
      const cmp =
        out.ok && out.kind === "comparison" ? out.comparison : null;
      const ok =
        out.ok &&
        out.kind === "comparison" &&
        cmp?.v === 3 &&
        (cmp.groups?.length ?? 0) >= 2;
      record(
        12,
        "comparison by category two groups",
        ok,
        `kind=${out.ok ? out.kind : "?"} groups=${cmp?.groups?.length}`
      );
    }
  }

  // 13. Persist comparison metric — kind=comparison, computed_value v:3
  {
    if (!r1TenantId) {
      record(13, "persist comparison kind=comparison", false, "missing r1 tenant");
    } else {
      const def = comparisonYearDef("Tax");
      const name = `gate_b14_cmp_${Date.now()}`;
      const created = await createMetric(admin, {
        tenantId: r1TenantId,
        operatorUserId: r1OperatorId,
        scope: "client",
        clientId: r1ClientId,
        name,
        description: "B14 gate comparison",
        definition: def,
        source: "platform",
      });
      cleanupIds.push(created.id);
      const computed = await computeMetricValue(admin, {
        id: created.id,
        tenant_id: r1TenantId,
        client_user_id: r1ClientId,
        definition: def,
      });
      const { data: row } = await admin
        .from("treasury_metrics")
        .select("kind, computed_value")
        .eq("id", created.id)
        .single();
      const cv = row?.computed_value as { v?: number; kind?: string } | null;
      const ok =
        created.kind === "comparison" &&
        row?.kind === "comparison" &&
        computed.kind === "comparison" &&
        computed.comparison?.v === 3 &&
        cv?.v === 3 &&
        cv?.kind === "comparison";
      record(
        13,
        "persist comparison kind=comparison",
        ok,
        `createKind=${created.kind} rowKind=${row?.kind} v=${cv?.v}`
      );
    }
  }

  // 14. Analytics regression — subdivision still maps to analytics (not comparison)
  {
    const kind = kindFromDefinition({
      of: "series_totals",
      subdivision: "month",
    });
    record(
      14,
      "analytics kind unchanged (series_totals)",
      kind === "analytics",
      `kind=${kind}`
    );
  }

  for (const id of cleanupIds) {
    if (id) {
      await admin
        .from("treasury_metrics")
        .update({ status: "discarded" })
        .eq("id", id);
    }
  }

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(15, "npm run build", true, "green");

  log("");
  log("=== Spec B5/B14 gate: ALL PASS ===");
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B5 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
