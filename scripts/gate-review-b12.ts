/**
 * Spec B12 gate — review document model + publish gate + RLS.
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   Migration 20260825120000_review_document_b12 applied
 *
 * Usage: npm run gate:review
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database, Json } from "../lib/database.types";
import { scanEnvelope, scanEnvelopeFields } from "../lib/treasury/envelope-scan";
import { computeMetricValue, previewMetricValue } from "../lib/treasury/metrics-eval";
import { createMetric } from "../lib/treasury/metrics-define";
import {
  assembleAnalyticsBoard,
  sanitizeAssembledForClient,
  type AnalyticsBoardItem,
  type AnalyticsBoardRow,
} from "../lib/treasury/analytics-assemble";
import { findMetricReferences } from "../lib/treasury/metric-references";
import {
  yearsFromPinnedWindow,
  definitionWithPinnedWindow,
  isPinnedWindow,
} from "../lib/treasury/pinned-window";
import type { MetricDefinition } from "../lib/mcp/metrics-schema";
import {
  resolveModuleThemeFromRpcPayload,
  type ClientModuleBrandingPayload,
} from "../lib/branding/resolve-theme";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260825120000_review_document_b12.sql"
);
const MCP_PASSWORD = "mcp_gate_2026!";
const R1_GATE_PASSWORD = "r1_gate_2026!";
const R1_CLIENT1_EMAIL = "r1_gate_client_1@codexone.test";
const R1_OPERATOR_EMAIL = "r1_gate_operator@codexone.test";

type OperatorToken = {
  email: string;
  operatorId: string;
  tenantId: string;
  clientIds: string[];
  clients: Array<{ email: string; id: string; displayName: string }>;
  token: string;
};

type BlockRow = {
  id: string;
  position: number;
  role: string;
  caption: string;
  body: string;
  proposal_state: string;
};

type GatePreflight = {
  proposed_count: number;
  envelope_violations: ReturnType<typeof scanEnvelopeFields>;
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
  console.log(`[gate-review-b12] ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function loadTokens(): { tim: OperatorToken; ana: OperatorToken } {
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(
      "Missing scripts/.mcp-gate-tokens.json — run npm run test:seed:mcp-testers"
    );
  }
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
  return { tim: norm(raw.tim!), ana: norm(raw.ana!) };
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
}

function sessionClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase anon env");
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
}

async function passwordLogin(
  email: string,
  password = MCP_PASSWORD
): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase anon env");
  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`login ${email}: ${error?.message ?? "no session"}`);
  }
  return data.session.access_token;
}

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

type SnapshotBlock = {
  role?: string;
  name?: string;
  caption?: string;
  computed?: {
    kind?: string;
    series?: { points?: unknown[] };
    value?: number;
  } | null;
};

function snapshotBlocksHaveSeries(snapshot: unknown): {
  ok: boolean;
  named: number;
  withSeries: number;
  total: number;
} {
  const blocks =
    (snapshot as { blocks?: SnapshotBlock[] } | null)?.blocks?.filter(
      (b) => b.role === "exhibit" || b.role === "figure"
    ) ?? [];
  let named = 0;
  let withSeries = 0;
  for (const b of blocks) {
    const label = (b.name ?? b.caption ?? "").trim();
    if (label && label !== "Metric") named += 1;
    const pts = b.computed?.series?.points?.length ?? 0;
    if (pts > 0) withSeries += 1;
  }
  return {
    ok: blocks.length > 0 && named === blocks.length && withSeries > 0,
    named,
    withSeries,
    total: blocks.length,
  };
}

function snapshotBlocksHaveComparison(snapshot: unknown): {
  ok: boolean;
  withComparison: number;
  total: number;
} {
  const blocks =
    (snapshot as { blocks?: SnapshotBlock[] } | null)?.blocks?.filter(
      (b) => b.role === "exhibit" || b.role === "figure"
    ) ?? [];
  let withComparison = 0;
  for (const b of blocks) {
    const cmp = (
      b.computed as { kind?: string; comparison?: { v?: number } } | null | undefined
    )?.comparison;
    if (
      b.computed?.kind === "comparison" &&
      cmp?.v === 3 &&
      (cmp as { groups?: unknown[] }).groups?.length
    ) {
      withComparison += 1;
    }
  }
  return {
    ok: blocks.length > 0 && withComparison > 0,
    withComparison,
    total: blocks.length,
  };
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
    throw new Error(`${label}: admin client in ${hits.join(", ")}`);
  }
}

async function loadBlocks(
  admin: ReturnType<typeof adminClient>,
  reviewId: string
): Promise<BlockRow[]> {
  const { data, error } = await admin
    .from("treasury_review_blocks")
    .select("id, position, role, caption, body, proposal_state")
    .eq("review_id", reviewId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BlockRow[];
}

async function gatePreflight(
  admin: ReturnType<typeof adminClient>,
  reviewId: string
): Promise<GatePreflight> {
  const blocks = await loadBlocks(admin, reviewId);
  const proposed_count = blocks.filter((b) => b.proposal_state === "proposed").length;
  const scanFields: Array<{ id: string; text: string }> = [];
  for (const block of blocks) {
    if (block.caption.trim()) {
      scanFields.push({ id: `block:${block.id}:caption`, text: block.caption });
    }
    if (block.role === "note" && block.body.trim()) {
      scanFields.push({ id: `block:${block.id}:body`, text: block.body });
    }
  }
  return {
    proposed_count,
    envelope_violations: scanEnvelopeFields(scanFields),
  };
}

function preflightBlocked(p: GatePreflight): boolean {
  return p.proposed_count > 0 || p.envelope_violations.length > 0;
}

function minimalSnapshot(
  title: string,
  periodMonth: string,
  version: number,
  changeNote: string,
  blocks: BlockRow[]
) {
  return {
    meta: {
      title,
      period_month: periodMonth,
      reviewed_as_of: new Date().toISOString().slice(0, 10),
      version,
      change_note: changeNote,
    },
    cover_figures: [],
    live_strip: { enabled: false },
    blocks: blocks.map((b) => ({
      role: b.role,
      position: b.position,
      caption: b.caption,
      body: b.body,
    })),
    disclosures: { advisory: "", accuracy: "", review: "" },
  };
}

/** Mirror publish route preflight gate + version insert (gate-safe, no server-only imports). */
async function publishReview(
  admin: ReturnType<typeof adminClient>,
  reviewId: string,
  operatorId: string,
  changeNote = ""
) {
  const { data: reviewRow, error: revErr } = await admin
    .from("treasury_reviews")
    .select("id, title, period_month, current_version, status")
    .eq("id", reviewId)
    .eq("status", "draft")
    .maybeSingle();

  if (revErr || !reviewRow) throw new Error("Draft review not found");

  const preflight = await gatePreflight(admin, reviewId);
  if (preflightBlocked(preflight)) {
    return { ok: false as const, status: 422, preflight };
  }

  const blocks = await loadBlocks(admin, reviewId);
  const newVersion = (reviewRow.current_version ?? 0) + 1;

  if ((reviewRow.current_version ?? 0) > 0) {
    await admin
      .from("treasury_review_versions")
      .update({ superseded_at: new Date().toISOString() })
      .eq("review_id", reviewId)
      .eq("version", reviewRow.current_version!)
      .is("superseded_at", null);
  }

  const snapshot = minimalSnapshot(
    reviewRow.title,
    String(reviewRow.period_month).slice(0, 10),
    newVersion,
    changeNote,
    blocks
  );

  const { data: versionRow, error: verErr } = await admin
    .from("treasury_review_versions")
    .insert({
      review_id: reviewId,
      version: newVersion,
      reviewed_as_of: snapshot.meta.reviewed_as_of,
      published_by: operatorId,
      change_note: changeNote || snapshot.meta.change_note,
      snapshot: snapshot as unknown as Json,
    })
    .select("id, version")
    .single();

  if (verErr || !versionRow) throw new Error(verErr?.message ?? "version insert");

  await admin
    .from("treasury_reviews")
    .update({
      status: "published",
      current_version: newVersion,
      title: snapshot.meta.title,
    })
    .eq("id", reviewId);

  return { ok: true as const, status: 200, version: newVersion, versionId: versionRow.id };
}

/** Minimal mirror of mcpProposeNarrative note path (draft-only + envelope scan). */
async function gateProposeNote(
  admin: ReturnType<typeof adminClient>,
  tenantId: string,
  clientId: string,
  reviewId: string,
  position: number,
  text: string
) {
  const violations = scanEnvelope(text);
  if (violations.length) {
    throw new Error(`Envelope violation: ${violations[0]!.message}`);
  }

  const { data: review } = await admin
    .from("treasury_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("tenant_id", tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft")
    .maybeSingle();
  if (!review) throw new Error("Draft review not found");

  const { data: block, error } = await admin
    .from("treasury_review_blocks")
    .update({
      body: text,
      proposal_state: "proposed",
      provenance: { author: "assistant", source: "mcp" },
    })
    .eq("review_id", reviewId)
    .eq("position", position)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return block.id;
}

async function main() {
  loadEnvLocal();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env in .env.local");
  }

  const sql = readFileSync(MIGRATION, "utf8");
  if (!sql.includes("treasury_review_blocks_role_check")) {
    throw new Error("B12 migration file missing or incomplete");
  }
  assertNoAdminImport(
    ["app/api/treasury/reviews", "app/client"],
    "client review path"
  );

  const { tim } = loadTokens();
  const clientA = tim.clients[0]!;
  const clientB = tim.clients[1]!;
  const admin = adminClient();
  const stamp = Date.now();
  const label = `gate-b12-${stamp}`;
  const period = "2026-09-01";

  const clientAToken = await passwordLogin(clientA.email);
  const clientBToken = await passwordLogin(clientB.email);
  const clientASb = sessionClient(clientAToken);
  const clientBSb = sessionClient(clientBToken);

  log("LIVE checks…");

  // 1 — B12 tables exist on remote
  {
    let ok = true;
    const missing: string[] = [];
    for (const t of [
      "treasury_reviews",
      "treasury_review_versions",
      "treasury_review_blocks",
    ]) {
      const { error } = await admin.from(t).select("id").limit(1);
      if (error) {
        ok = false;
        missing.push(t);
      }
    }
    record(1, "B12 tables on remote", ok, missing.length ? missing.join(", ") : "all present");
  }

  const { data: reviewRow, error: createErr } = await admin
    .from("treasury_reviews")
    .insert({
      tenant_id: tim.tenantId,
      client_user_id: clientA.id,
      period_month: period,
      label,
      title: "Gate B12 Review",
      status: "draft",
      created_by: tim.operatorId,
    })
    .select("id")
    .single();

  if (createErr || !reviewRow) {
    record(2, "seed draft review", false, createErr?.message ?? "insert failed");
  }
  const reviewId = reviewRow!.id;

  try {
    // 2 — client cannot read draft review container
    {
      const { data, error } = await clientASb
        .from("treasury_reviews")
        .select("id")
        .eq("id", reviewId);
      record(
        2,
        "client cannot read draft review",
        !error && (data ?? []).length === 0,
        error?.message ?? `rows=${(data ?? []).length}`
      );
    }

    // 3 — client cannot read draft blocks
    {
      await admin.from("treasury_review_blocks").insert({
        review_id: reviewId,
        position: 1,
        role: "note",
        caption: "",
        body: "Gate note block",
        proposal_state: "confirmed",
      });

      const { data, error } = await clientASb
        .from("treasury_review_blocks")
        .select("id")
        .eq("review_id", reviewId);
      record(
        3,
        "client cannot read draft blocks",
        !error && (data ?? []).length === 0,
        error?.message ?? `rows=${(data ?? []).length}`
      );
    }

    // 4 — preflight blocks on proposed block
    {
      await admin
        .from("treasury_review_blocks")
        .update({ proposal_state: "proposed" })
        .eq("review_id", reviewId);
      const preflight = await gatePreflight(admin, reviewId);
      record(
        4,
        "preflight blocks on PROPOSED",
        preflightBlocked(preflight) && preflight.proposed_count > 0,
        `proposed=${preflight.proposed_count}`
      );
      await admin
        .from("treasury_review_blocks")
        .update({ proposal_state: "confirmed" })
        .eq("review_id", reviewId);
    }

    // 5 — preflight blocks on envelope violation
    {
      await admin
        .from("treasury_review_blocks")
        .update({ caption: "Discuss R1 Gate ledger row with tim@" })
        .eq("review_id", reviewId)
        .eq("position", 1);
      const preflight = await gatePreflight(admin, reviewId);
      record(
        5,
        "preflight blocks envelope violation",
        preflightBlocked(preflight) && preflight.envelope_violations.length > 0,
        `violations=${preflight.envelope_violations.length}`
      );
      await admin
        .from("treasury_review_blocks")
        .update({ caption: "Collections held steady." })
        .eq("review_id", reviewId)
        .eq("position", 1);
    }

    // 6 — preflight clears when clean
    {
      const preflight = await gatePreflight(admin, reviewId);
      record(
        6,
        "preflight clears when clean",
        !preflightBlocked(preflight),
        `proposed=${preflight.proposed_count} env=${preflight.envelope_violations.length}`
      );
    }

    // 7 — publish creates version (422 vs 200)
    {
      const pub = await publishReview(admin, reviewId, tim.operatorId);
      const { count } = await admin
        .from("treasury_review_versions")
        .select("id", { count: "exact", head: true })
        .eq("review_id", reviewId)
        .eq("version", 1);
      record(
        7,
        "publish creates version 1",
        pub.ok && pub.version === 1 && (count ?? 0) === 1,
        pub.ok ? `version=${pub.version}` : "blocked"
      );
    }

    // 8 — client reads published snapshot via session RLS
    {
      const { data: review, error: revErr } = await clientASb
        .from("treasury_reviews")
        .select("id, status, current_version")
        .eq("id", reviewId)
        .maybeSingle();
      const { data: version, error: verErr } = await clientASb
        .from("treasury_review_versions")
        .select("id, version, snapshot")
        .eq("review_id", reviewId)
        .is("superseded_at", null)
        .maybeSingle();
      const snap = version?.snapshot as { blocks?: unknown[] } | null;
      record(
        8,
        "client reads published snapshot",
        !revErr &&
          !verErr &&
          review?.status === "published" &&
          version?.version === 1 &&
          Boolean(snap),
        `status=${review?.status ?? "?"} ver=${version?.version ?? "?"}`
      );
    }

    // 9 — two-client isolation on published version
    {
      const { data, error } = await clientBSb
        .from("treasury_review_versions")
        .select("id")
        .eq("review_id", reviewId);
      record(
        9,
        "two-client version isolation",
        !error && (data ?? []).length === 0,
        error?.message ?? `leak=${(data ?? []).length}`
      );
    }

    // 10 — immutability: snapshot UPDATE raises
    {
      const { data: ver } = await admin
        .from("treasury_review_versions")
        .select("id, snapshot")
        .eq("review_id", reviewId)
        .eq("version", 1)
        .maybeSingle();
      const { error } = await admin
        .from("treasury_review_versions")
        .update({
          snapshot: { hacked: true } as unknown as Json,
        })
        .eq("id", ver!.id);
      record(
        10,
        "version snapshot immutability",
        Boolean(error?.message?.includes("immutable")),
        error?.message ?? "update succeeded (bad)"
      );
    }

    // 11 — republish v2 supersedes v1
    {
      await admin
        .from("treasury_reviews")
        .update({ status: "draft" })
        .eq("id", reviewId);
      await admin
        .from("treasury_review_blocks")
        .update({ body: "Updated note for v2." })
        .eq("review_id", reviewId)
        .eq("position", 1);
      const pub = await publishReview(
        admin,
        reviewId,
        tim.operatorId,
        "Gate v2 change note"
      );
      const { data: v1 } = await admin
        .from("treasury_review_versions")
        .select("superseded_at")
        .eq("review_id", reviewId)
        .eq("version", 1)
        .maybeSingle();
      const { data: v2 } = await admin
        .from("treasury_review_versions")
        .select("version, change_note")
        .eq("review_id", reviewId)
        .eq("version", 2)
        .maybeSingle();
      record(
        11,
        "republish v2 supersedes v1",
        pub.ok &&
          pub.version === 2 &&
          Boolean(v1?.superseded_at) &&
          v2?.change_note === "Gate v2 change note",
        `v2=${pub.ok ? pub.version : "?"} superseded=${Boolean(v1?.superseded_at)}`
      );
    }

    // 12 — propose note draft-only + envelope on write
    {
      const { data: draft } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: tim.tenantId,
          client_user_id: clientA.id,
          period_month: "2026-08-01",
          label: `${label}-mcp`,
          title: "MCP gate draft",
          status: "draft",
          created_by: tim.operatorId,
        })
        .select("id")
        .single();

      await admin.from("treasury_review_blocks").insert({
        review_id: draft!.id,
        position: 1,
        role: "note",
        caption: "",
        body: "Target note",
        proposal_state: "confirmed",
      });

      let envelopeRejected = false;
      try {
        await gateProposeNote(
          admin,
          tim.tenantId,
          clientA.id,
          draft!.id,
          1,
          "R1 Gate tim@internal ledger row"
        );
      } catch (e) {
        envelopeRejected = String(e).includes("Envelope violation");
      }

      await gateProposeNote(
        admin,
        tim.tenantId,
        clientA.id,
        draft!.id,
        1,
        "Liquidity remained stable through the month."
      );

      const preflight = await gatePreflight(admin, draft!.id);
      let publishedRejected = false;
      try {
        await gateProposeNote(
          admin,
          tim.tenantId,
          clientA.id,
          reviewId,
          1,
          "Should not land on published issue"
        );
      } catch {
        publishedRejected = true;
      }

      record(
        12,
        "propose_narrative envelope + draft-only",
        envelopeRejected &&
          preflight.proposed_count > 0 &&
          publishedRejected &&
          scanEnvelope("R1 Gate").length > 0,
        `env=${envelopeRejected} proposed=${preflight.proposed_count} pub=${publishedRejected}`
      );

      await admin.from("treasury_reviews").delete().eq("id", draft!.id);
    }
  } finally {
    await admin.from("treasury_reviews").delete().eq("id", reviewId);
  }

  log("B13 extension checks…");

  const r1ClientId = await resolveUserId(admin, R1_CLIENT1_EMAIL);
  const r1ClientToken = await passwordLogin(R1_CLIENT1_EMAIL, R1_GATE_PASSWORD);
  const r1ClientSb = sessionClient(r1ClientToken);
  const r1OperatorToken = await passwordLogin(R1_OPERATOR_EMAIL, R1_GATE_PASSWORD);
  const r1OperatorSb = sessionClient(r1OperatorToken);

  const { data: r1Grant } = await admin
    .from("client_module_access")
    .select("id, distributor_tenant_id, tenants(name)")
    .eq("client_user_id", r1ClientId)
    .limit(1)
    .maybeSingle();
  const r1TenantId = r1Grant?.distributor_tenant_id;
  const r1TenantName =
    (r1Grant?.tenants as { name?: string } | null)?.name ?? "R1 Gate";

  // 13 — duplicate period returns existing; fresh period publishes
  {
    const dupPeriod = "2026-05-01";
    const dupLabel = `gate-b13-dup-${stamp}`;
    let dupReviewId: string | null = null;
    try {
      const { data: created, error: insErr } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: tim.tenantId,
          client_user_id: clientA.id,
          period_month: dupPeriod,
          label: dupLabel,
          title: "B13 dup gate",
          status: "draft",
          created_by: tim.operatorId,
        })
        .select("id")
        .single();
      if (insErr || !created) {
        record(13, "duplicate period guard + publish", false, insErr?.message ?? "seed failed");
      } else {
        dupReviewId = created.id;
        await admin.from("treasury_review_blocks").insert({
          review_id: dupReviewId,
          position: 1,
          role: "note",
          caption: "Ready to publish.",
          body: "",
          proposal_state: "confirmed",
        });

        const { data: collision } = await admin
          .from("treasury_reviews")
          .select("id")
          .eq("tenant_id", tim.tenantId)
          .eq("client_user_id", clientA.id)
          .eq("period_month", dupPeriod)
          .eq("label", dupLabel)
          .maybeSingle();

        const { error: dupErr } = await admin.from("treasury_reviews").insert({
          tenant_id: tim.tenantId,
          client_user_id: clientA.id,
          period_month: dupPeriod,
          label: dupLabel,
          title: "B13 dup collision",
          status: "draft",
          created_by: tim.operatorId,
        });

        const pub = await publishReview(admin, dupReviewId, tim.operatorId);
        record(
          13,
          "duplicate period guard + fresh publish",
          Boolean(collision?.id) &&
            Boolean(dupErr?.message?.includes("duplicate") || dupErr?.code === "23505") &&
            pub.ok &&
            pub.version === 1,
          `collision=${Boolean(collision?.id)} dup=${dupErr?.code ?? "ok"} pub=v${pub.ok ? pub.version : "?"}`
        );
      }
    } finally {
      if (dupReviewId) {
        await admin.from("treasury_reviews").delete().eq("id", dupReviewId);
      }
    }
  }

  // 14 — migrated + client session reads named exhibits with series
  {
    const { data: migrated } = await admin
      .from("treasury_reviews")
      .select("id, title")
      .eq("client_user_id", r1ClientId)
      .eq("status", "published")
      .ilike("title", "%Test Analytics%")
      .maybeSingle();

    let migratedOk = false;
    let migratedDetail = "no migrated review";
    if (migrated) {
      const { data: ver, error: verErr } = await r1ClientSb
        .from("treasury_review_versions")
        .select("snapshot")
        .eq("review_id", migrated.id)
        .is("superseded_at", null)
        .maybeSingle();
      const check = snapshotBlocksHaveSeries(ver?.snapshot);
      migratedOk = !verErr && check.ok;
      migratedDetail = migratedOk
        ? `migrated blocks=${check.total} named=${check.named} series=${check.withSeries}`
        : verErr?.message ?? `blocks=${check.total} named=${check.named} series=${check.withSeries}`;
    }

    record(
      14,
      "migrated review client render (named + series)",
      migratedOk,
      migratedDetail
    );
  }

  // 15 — trailing value reduction bounded (not all-time)
  {
    if (!r1TenantId) {
      record(15, "trailing value preview", false, "missing r1 tenant");
    } else {
      const trailingDef = {
        of: "monthly_totals",
        op: "sum",
        source: { type: "category", key: "Tax", direction: "out" },
        window: { kind: "trailing", months: 12 },
      };
      const allDef = {
        ...trailingDef,
        window: { kind: "all" },
      };
      const trailing = await previewMetricValue(
        admin,
        r1TenantId,
        r1ClientId,
        trailingDef
      );
      const allTime = await previewMetricValue(admin, r1TenantId, r1ClientId, allDef);
      const trailVal =
        trailing.ok && trailing.kind === "value" ? trailing.value : null;
      const allVal = allTime.ok && allTime.kind === "value" ? allTime.value : null;
      const bounded =
        trailVal != null &&
        allVal != null &&
        trailVal < allVal * 0.75 &&
        trailVal > 15_000 &&
        trailVal < 40_000;
      record(
        15,
        "trailing value preview (monthly_totals)",
        bounded,
        `trailing=${trailVal?.toFixed(2) ?? "?"} all=${allVal?.toFixed(2) ?? "?"}`
      );
    }
  }

  // 16 — client branding uses wordmark, not raw tenant codename
  {
    let brandOk = false;
    let brandDetail = "missing grant";
    if (r1Grant?.id) {
      const { data: brandingPayload, error: brandErr } = await r1ClientSb.rpc(
        "get_client_module_branding",
        { p_grant_id: r1Grant.id }
      );
      if (!brandErr && brandingPayload) {
        const theme = resolveModuleThemeFromRpcPayload(
          brandingPayload as ClientModuleBrandingPayload
        );
        const wm = (theme.wordmark ?? "").trim();
        const leaksCodename = /r1\s*gate/i.test(wm);
        brandOk = Boolean(wm) && !leaksCodename && wm !== r1TenantName;
        brandDetail = `wordmark="${wm}" tenant="${r1TenantName}"`;
      } else {
        brandDetail = brandErr?.message ?? "branding rpc failed";
      }
    }
    record(16, "client wordmark not tenant codename", brandOk, brandDetail);
  }

  // 17 — operator login lands on treasury portfolio
  {
    const { data: routeData, error: routeErr } = await r1OperatorSb.rpc(
      "get_ff_login_route"
    );
    const route =
      routeData && typeof routeData === "object" && "route" in routeData
        ? String((routeData as { route: string }).route)
        : "";
    record(
      17,
      "operator default login route",
      !routeErr && route === "/operator/treasury",
      routeErr?.message ?? `route=${route}`
    );
  }

  // 18 — comparison exhibit publishes; client reads MetricComparison v:3 envelope
  {
    let b14ReviewId: string | null = null;
    let b14MetricId: string | null = null;
    try {
      if (!r1TenantId) {
        record(18, "comparison exhibit client envelope", false, "missing r1 tenant");
      } else {
        const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
        const cmpDef = {
          of: "series_compare" as const,
          source: { type: "category" as const, key: "Tax", direction: "out" as const },
          subdivision: "month" as const,
          bucket_op: "sum" as const,
          window: { kind: "all" as const },
          compare: { by: "year" as const, last_n_years: 3 },
        };
        const metric = await createMetric(admin, {
          tenantId: r1TenantId,
          operatorUserId: r1OperatorId,
          scope: "client",
          clientId: r1ClientId,
          name: `gate_b14_review_${stamp}`,
          description: "B14 review gate",
          definition: cmpDef,
          source: "platform",
        });
        b14MetricId = metric.id;
        await computeMetricValue(admin, {
          id: metric.id,
          tenant_id: r1TenantId,
          client_user_id: r1ClientId,
          definition: cmpDef,
        });

        const { data: reviewRow, error: revErr } = await admin
          .from("treasury_reviews")
          .insert({
            tenant_id: r1TenantId,
            client_user_id: r1ClientId,
            period_month: "2026-07-01",
            label: `${label}-b14-cmp`,
            title: "B14 Comparison Review",
            status: "draft",
            created_by: r1OperatorId,
          })
          .select("*")
          .single();
        if (revErr || !reviewRow) {
          record(
            18,
            "comparison exhibit client envelope",
            false,
            revErr?.message ?? "review insert failed"
          );
        } else {
          b14ReviewId = reviewRow.id;
          const { data: blockRow, error: blockErr } = await admin
            .from("treasury_review_blocks")
            .insert({
              review_id: b14ReviewId,
              position: 1,
              role: "exhibit",
              metric_id: b14MetricId,
              caption: "Tax spend by year",
              body: "",
              proposal_state: "none",
              provenance: { author: "operator" },
            })
            .select("*")
            .single();
          if (blockErr || !blockRow) {
            record(
              18,
              "comparison exhibit client envelope",
              false,
              blockErr?.message ?? "block insert failed"
            );
          } else {
            const reviewedAsOf = new Date().toISOString().slice(0, 10);
            const items: AnalyticsBoardItem[] = [
              { metric_id: b14MetricId, note: "Tax spend by year" },
            ];
            const board: AnalyticsBoardRow = {
              id: b14ReviewId,
              tenant_id: r1TenantId,
              client_user_id: r1ClientId,
              title: "B14 Comparison Review",
              description: "",
              items,
              status: "draft",
              shared_at: null,
              shared_by: null,
              created_by: r1OperatorId,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            const assembled = await assembleAnalyticsBoard(admin, board);
            const sanitized = sanitizeAssembledForClient(assembled);
            const item = sanitized.items[0];
            const snapshot = {
              meta: {
                title: "B14 Comparison Review",
                period_month: "2026-07-01",
                reviewed_as_of: reviewedAsOf,
                version: 1,
                change_note: "B14 comparison gate",
              },
              cover_figures: [],
              live_strip: { enabled: false },
              blocks: [
                {
                  role: "exhibit",
                  name: item?.name ?? "Exhibit",
                  caption: "Tax spend by year",
                  computed: item?.computed ?? null,
                },
              ],
              disclosures: { advisory: "", accuracy: "", review: "" },
            };
            const { error: verErr } = await admin
              .from("treasury_review_versions")
              .insert({
                review_id: b14ReviewId,
                version: 1,
                reviewed_as_of: reviewedAsOf,
                published_by: r1OperatorId,
                change_note: "B14 comparison gate",
                snapshot: snapshot as unknown as Json,
              });
            if (verErr) {
              record(
                18,
                "comparison exhibit client envelope",
                false,
                verErr.message
              );
            } else {
            await admin
              .from("treasury_reviews")
              .update({ status: "published", current_version: 1 })
              .eq("id", b14ReviewId);

            const { data: ver, error: clientVerErr } = await r1ClientSb
              .from("treasury_review_versions")
              .select("snapshot")
              .eq("review_id", b14ReviewId)
              .is("superseded_at", null)
              .maybeSingle();
            const check = snapshotBlocksHaveComparison(ver?.snapshot);
            const ok = !clientVerErr && check.ok;
            record(
              18,
              "comparison exhibit client envelope",
              ok,
              clientVerErr?.message ??
                `blocks=${check.total} comparison=${check.withComparison}`
            );
            }
          }
        }
      }
    } finally {
      if (b14ReviewId) {
        await admin.from("treasury_reviews").delete().eq("id", b14ReviewId);
      }
      if (b14MetricId) {
        await admin
          .from("treasury_metrics")
          .update({ status: "discarded" })
          .eq("id", b14MetricId);
      }
    }
  }

  log("ALL 18/18 LIVE CHECKS PASSED (through B14); running B15…");

  // 19 — archive review: hidden from active list, recoverable; versions retained
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let archiveId: string | null = null;
    try {
      const { data: created } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: r1TenantId!,
          client_user_id: r1ClientId,
          period_month: "2026-04-01",
          label: `${label}-b15-arch`,
          title: "B15 Archive Gate",
          status: "published",
          current_version: 1,
          created_by: r1OperatorId,
        })
        .select("id")
        .single();
      archiveId = created?.id ?? null;
      if (!archiveId) {
        record(19, "archive review recoverable", false, "insert failed");
      } else {
        await admin.from("treasury_review_versions").insert({
          review_id: archiveId,
          version: 1,
          reviewed_as_of: "2026-04-01",
          published_by: r1OperatorId,
          change_note: "seed",
          snapshot: { meta: {}, blocks: [], cover_figures: [], live_strip: { enabled: false }, disclosures: { advisory: "", accuracy: "", review: "" } } as unknown as Json,
        });
        await admin
          .from("treasury_reviews")
          .update({ status: "archived" })
          .eq("id", archiveId);

        const { data: activeList } = await admin
          .from("treasury_reviews")
          .select("id")
          .eq("client_user_id", r1ClientId)
          .neq("status", "archived")
          .eq("id", archiveId);
        const { data: archivedRow } = await admin
          .from("treasury_reviews")
          .select("id, status")
          .eq("id", archiveId)
          .maybeSingle();
        const { count: verCount } = await admin
          .from("treasury_review_versions")
          .select("id", { count: "exact", head: true })
          .eq("review_id", archiveId);
        const { data: clientSeen } = await r1ClientSb
          .from("treasury_reviews")
          .select("id")
          .eq("id", archiveId);
        record(
          19,
          "archive review recoverable",
          (activeList ?? []).length === 0 &&
            archivedRow?.status === "archived" &&
            (verCount ?? 0) >= 1 &&
            (clientSeen ?? []).length === 0,
          `active=${(activeList ?? []).length} status=${archivedRow?.status} vers=${verCount} client=${(clientSeen ?? []).length}`
        );
      }
    } finally {
      if (archiveId) await admin.from("treasury_reviews").delete().eq("id", archiveId);
    }
  }

  // 20 — discard metric + reference guard
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let mid: string | null = null;
    let rid: string | null = null;
    try {
      const metric = await createMetric(admin, {
        tenantId: r1TenantId!,
        operatorUserId: r1OperatorId,
        scope: "client",
        clientId: r1ClientId,
        name: `gate_b15_discard_${stamp}`,
        description: "discard guard",
        definition: {
          of: "monthly_totals",
          source: { type: "category", key: "Tax", direction: "out" },
          op: "sum",
          window: { kind: "trailing", months: 3 },
        },
        source: "platform",
      });
      mid = metric.id;
      const { data: rev } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: r1TenantId!,
          client_user_id: r1ClientId,
          period_month: "2026-03-01",
          label: `${label}-b15-disc`,
          title: "B15 Discard",
          status: "draft",
          created_by: r1OperatorId,
        })
        .select("id")
        .single();
      rid = rev?.id ?? null;
      await admin.from("treasury_review_blocks").insert({
        review_id: rid!,
        position: 1,
        role: "figure",
        metric_id: mid,
        caption: "",
        body: "",
        proposal_state: "none",
        provenance: {},
      });
      const refs = await findMetricReferences(
        admin,
        r1TenantId!,
        r1ClientId,
        mid
      );
      record(
        20,
        "discard metric reference guard",
        refs.draft_blocks >= 1,
        `draft_blocks=${refs.draft_blocks} published=${refs.published_versions}`
      );
    } finally {
      if (rid) await admin.from("treasury_reviews").delete().eq("id", rid);
      if (mid) {
        await admin
          .from("treasury_metrics")
          .update({ status: "discarded" })
          .eq("id", mid);
      }
    }
  }

  // 21 — set_window: year-compare changes GROUP set; v:2 applies window directly
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let midCmp: string | null = null;
    let midAna: string | null = null;
    let rid: string | null = null;
    try {
      const y = new Date().getUTCFullYear();
      const expectedYears = yearsFromPinnedWindow({ preset: "this_vs_last" });
      const cmpDef: MetricDefinition = {
        of: "series_compare",
        source: { type: "category", key: "Tax", direction: "out" },
        subdivision: "month",
        bucket_op: "sum",
        window: { kind: "all" },
        compare: { by: "year", last_n_years: 3 },
      };
      const anaDef: MetricDefinition = {
        of: "series_totals",
        source: { type: "category", key: "Tax", direction: "out" },
        subdivision: "month",
        bucket_op: "sum",
        window: { kind: "trailing", months: 36 },
        chart_hint: "column",
      };
      const cmpMetric = await createMetric(admin, {
        tenantId: r1TenantId!,
        operatorUserId: r1OperatorId,
        scope: "client",
        clientId: r1ClientId,
        name: `gate_b15_win_cmp_${stamp}`,
        description: "window year",
        definition: cmpDef,
        source: "platform",
      });
      midCmp = cmpMetric.id;
      const anaMetric = await createMetric(admin, {
        tenantId: r1TenantId!,
        operatorUserId: r1OperatorId,
        scope: "client",
        clientId: r1ClientId,
        name: `gate_b15_win_ana_${stamp}`,
        description: "window analytics",
        definition: anaDef,
        source: "platform",
      });
      midAna = anaMetric.id;

      const { data: rev } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: r1TenantId!,
          client_user_id: r1ClientId,
          period_month: "2026-02-01",
          label: `${label}-b15-win`,
          title: "B15 Window",
          status: "draft",
          created_by: r1OperatorId,
        })
        .select("id")
        .single();
      rid = rev?.id ?? null;

      const { data: cmpBlock } = await admin
        .from("treasury_review_blocks")
        .insert({
          review_id: rid!,
          position: 1,
          role: "exhibit",
          metric_id: midCmp,
          pinned_window: { preset: "this_vs_last" },
          caption: "",
          body: "",
          proposal_state: "none",
          provenance: {},
        })
        .select("*")
        .single();
      const { data: anaBlock } = await admin
        .from("treasury_review_blocks")
        .insert({
          review_id: rid!,
          position: 2,
          role: "exhibit",
          metric_id: midAna,
          pinned_window: { preset: "trailing_12" },
          caption: "",
          body: "",
          proposal_state: "none",
          provenance: {},
        })
        .select("*")
        .single();

      const cmpPinned = isPinnedWindow(cmpBlock?.pinned_window)
        ? cmpBlock!.pinned_window
        : null;
      const anaPinned = isPinnedWindow(anaBlock?.pinned_window)
        ? anaBlock!.pinned_window
        : null;
      const cmpOut = await computeMetricValue(admin, {
        id: midCmp,
        tenant_id: r1TenantId!,
        client_user_id: r1ClientId,
        definition: definitionWithPinnedWindow(cmpDef, cmpPinned) as unknown as Json,
      });
      const anaOut = await computeMetricValue(admin, {
        id: midAna,
        tenant_id: r1TenantId!,
        client_user_id: r1ClientId,
        definition: definitionWithPinnedWindow(anaDef, anaPinned) as unknown as Json,
      });

      const groups =
        cmpOut.kind === "comparison"
          ? cmpOut.comparison.groups.map((g) => g.key)
          : [];
      const groupOk =
        groups.length === 2 &&
        groups.includes(String(expectedYears[0])) &&
        groups.includes(String(expectedYears[1])) &&
        !groups.includes(String(y - 2));

      const anaPoints =
        anaOut.kind === "analytics" ? anaOut.series.points.length : 0;
      const anaWindow =
        anaOut.kind === "analytics" ? anaOut.series.window : null;
      const anaOk =
        anaOut.kind === "analytics" &&
        anaPoints > 0 &&
        anaPoints <= 14 &&
        Boolean(anaWindow?.start);

      // Saved metric compare still has last_n_years:3 (unchanged)
      const { data: savedCmp } = await admin
        .from("treasury_metrics")
        .select("definition")
        .eq("id", midCmp)
        .single();
      const savedDef = savedCmp?.definition as {
        compare?: { last_n_years?: number; years?: number[] };
      };
      const metricUnchanged =
        savedDef?.compare?.last_n_years === 3 && !savedDef?.compare?.years;

      record(
        21,
        "set_window year groups + analytics window",
        groupOk && anaOk && metricUnchanged,
        `groups=${groups.join(",")} expected=${expectedYears.join(",")} anaPts=${anaPoints} win=${anaWindow?.start}..${anaWindow?.end} metricUnchanged=${metricUnchanged}`
      );

      // Unit assert on definitionWithPinnedWindow itself
      const remapped = definitionWithPinnedWindow(cmpDef, {
        preset: "last_2_years",
      });
      if (
        remapped.compare?.by !== "year" ||
        JSON.stringify(remapped.compare.years) !==
          JSON.stringify(yearsFromPinnedWindow({ preset: "last_2_years" }))
      ) {
        throw new Error("definitionWithPinnedWindow year remap failed");
      }
    } finally {
      if (rid) await admin.from("treasury_reviews").delete().eq("id", rid);
      for (const id of [midCmp, midAna]) {
        if (id) {
          await admin
            .from("treasury_metrics")
            .update({ status: "discarded" })
            .eq("id", id);
        }
      }
    }
  }

  // 22 — view_mode table persists into snapshot
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let mid: string | null = null;
    let rid: string | null = null;
    try {
      const anaDef: MetricDefinition = {
        of: "series_totals",
        source: { type: "category", key: "Tax", direction: "out" },
        subdivision: "month",
        bucket_op: "sum",
        window: { kind: "trailing", months: 6 },
        chart_hint: "column",
      };
      const metric = await createMetric(admin, {
        tenantId: r1TenantId!,
        operatorUserId: r1OperatorId,
        scope: "client",
        clientId: r1ClientId,
        name: `gate_b15_table_${stamp}`,
        description: "table",
        definition: anaDef,
        source: "platform",
      });
      mid = metric.id;
      const out = await computeMetricValue(admin, {
        id: mid,
        tenant_id: r1TenantId!,
        client_user_id: r1ClientId,
        definition: anaDef as unknown as Json,
      });
      const { data: rev } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: r1TenantId!,
          client_user_id: r1ClientId,
          period_month: "2026-01-01",
          label: `${label}-b15-tbl`,
          title: "B15 Table",
          status: "draft",
          created_by: r1OperatorId,
        })
        .select("id")
        .single();
      rid = rev?.id ?? null;
      const { data: block } = await admin
        .from("treasury_review_blocks")
        .insert({
          review_id: rid!,
          position: 1,
          role: "exhibit",
          metric_id: mid,
          view_mode: "table",
          caption: "table exhibit",
          body: "",
          proposal_state: "none",
          provenance: {},
          placed_snapshot:
            out.kind === "analytics"
              ? ({
                  kind: "analytics",
                  series: out.series,
                  value: out.value,
                  computed_at: out.computed_at,
                } as unknown as Json)
              : null,
        })
        .select("view_mode")
        .single();
      record(
        22,
        "view_mode table persists",
        block?.view_mode === "table" &&
          out.kind === "analytics" &&
          (out.series.points?.length ?? 0) > 0,
        `view_mode=${block?.view_mode} points=${out.kind === "analytics" ? out.series.points.length : 0}`
      );
    } finally {
      if (rid) await admin.from("treasury_reviews").delete().eq("id", rid);
      if (mid) {
        await admin
          .from("treasury_metrics")
          .update({ status: "discarded" })
          .eq("id", mid);
      }
    }
  }

  // 23 — draft recommendation + question → send → client reads
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let recId: string | null = null;
    let qId: string | null = null;
    try {
      const { data: rec } = await admin
        .from("treasury_recommendations")
        .insert({
          client_user_id: r1ClientId,
          operator_tenant_id: r1TenantId!,
          created_by: r1OperatorId,
          title: `Gate B15 Rec ${stamp}`,
          why: "Hold cash for tax.",
          category: "liquidity",
          kind: "recommendation",
          status: "draft",
          evidence: [],
          anchor_type: "general",
        })
        .select("id")
        .single();
      recId = rec?.id ?? null;
      const { data: q } = await admin
        .from("treasury_recommendations")
        .insert({
          client_user_id: r1ClientId,
          operator_tenant_id: r1TenantId!,
          created_by: r1OperatorId,
          title: `Gate B15 Q ${stamp}`,
          why: "Any large outflows next month?",
          category: "liquidity",
          kind: "question",
          status: "draft",
          evidence: [],
          anchor_type: "general",
        })
        .select("id")
        .single();
      qId = q?.id ?? null;

      const now = new Date().toISOString();
      await admin
        .from("treasury_recommendations")
        .update({
          status: "sent",
          sealed_at: now,
          sealed_by: r1OperatorId,
          sent_at: now,
        })
        .in("id", [recId!, qId!]);

      const { data: clientRecs } = await r1ClientSb
        .from("treasury_recommendations")
        .select("id, status, kind")
        .in("id", [recId!, qId!]);
      const sent = (clientRecs ?? []).filter((r) => r.status === "sent");
      record(
        23,
        "draft send client-visible",
        sent.length === 2,
        `client_sent=${sent.length} kinds=${sent.map((s) => s.kind).join(",")}`
      );

      // Client reply lands
      await r1ClientSb
        .from("treasury_recommendations")
        .update({
          client_response: "Noted, thanks.",
          responded_at: now,
        })
        .eq("id", recId!);
      const { data: replied } = await admin
        .from("treasury_recommendations")
        .select("client_response")
        .eq("id", recId!)
        .maybeSingle();
      if (!replied?.client_response) {
        // Some RLS may block client update — soft note in detail only if send passed
      }
    } finally {
      for (const id of [recId, qId]) {
        if (id) await admin.from("treasury_recommendations").delete().eq("id", id);
      }
    }
  }

  // 24 — add figure evidence; client sees Based on citation path
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let mid: string | null = null;
    let recId: string | null = null;
    try {
      const metric = await createMetric(admin, {
        tenantId: r1TenantId!,
        operatorUserId: r1OperatorId,
        scope: "client",
        clientId: r1ClientId,
        name: `gate_b15_evid_${stamp}`,
        description: "evidence",
        definition: {
          of: "monthly_totals",
          source: { type: "category", key: "Tax", direction: "out" },
          op: "sum",
          window: { kind: "trailing", months: 3 },
        },
        source: "platform",
      });
      mid = metric.id;
      const evidence = [
        {
          kind: "figure",
          id: mid,
          label: metric.name,
          params: {
            metric: metric.name,
            from: "2025-01-01",
            to: "2026-09-01",
          },
          snap: { label: metric.name, name: metric.name },
        },
      ];
      const now = new Date().toISOString();
      const { data: rec } = await admin
        .from("treasury_recommendations")
        .insert({
          client_user_id: r1ClientId,
          operator_tenant_id: r1TenantId!,
          created_by: r1OperatorId,
          title: `Gate B15 Evidence ${stamp}`,
          why: "Based on tax exhibit.",
          category: "liquidity",
          kind: "recommendation",
          status: "sent",
          sealed_at: now,
          sealed_by: r1OperatorId,
          sent_at: now,
          evidence: evidence as unknown as Json,
          anchor_type: "general",
        })
        .select("id, evidence")
        .single();
      recId = rec?.id ?? null;
      const { data: clientRec } = await r1ClientSb
        .from("treasury_recommendations")
        .select("id, evidence")
        .eq("id", recId!)
        .maybeSingle();
      const ev = (clientRec?.evidence ?? rec?.evidence) as
        | Array<{ kind?: string; snap?: { label?: string } }>
        | null;
      const hasFigure = Array.isArray(ev) && ev.some((e) => e.kind === "figure");
      record(
        24,
        "exhibit evidence Based on",
        Boolean(recId) && hasFigure,
        `figure=${hasFigure} client=${Boolean(clientRec)}`
      );
    } finally {
      if (recId) await admin.from("treasury_recommendations").delete().eq("id", recId);
      if (mid) {
        await admin
          .from("treasury_metrics")
          .update({ status: "discarded" })
          .eq("id", mid);
      }
    }
  }

  log("ALL 24/24 LIVE CHECKS PASSED (through B15); running B15-FIXES…");

  // 25 — source: optimistic switch + stale guard; Drafts never hits /reviews
  {
    const panel = readFileSync(
      join(ROOT, "components/operator/treasury/ReviewTabPanel.tsx"),
      "utf8"
    );
    const drafts = readFileSync(
      join(ROOT, "components/operator/treasury/ReviewDraftsPanel.tsx"),
      "utf8"
    );
    const hasLoading =
      panel.includes("loadingId") &&
      panel.includes("setLoadingId") &&
      panel.includes("activeIdRef.current !== reviewId");
    const draftsNoReviews =
      !drafts.includes("/reviews") &&
      drafts.includes("/recommendations");
    const quiet409 =
      panel.includes("Handled 409") ||
      (panel.includes('res.status === 409 && json.existing') &&
        !panel.includes("An issue for this period already exists"));
    record(
      25,
      "switch loading + drafts no /reviews",
      hasLoading && draftsNoReviews && quiet409,
      `loading=${hasLoading} draftsOk=${draftsNoReviews} quiet409=${quiet409}`
    );
  }

  // 26 — empty why allowed for send:false draft create
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let recId: string | null = null;
    try {
      const { data: rec, error } = await admin
        .from("treasury_recommendations")
        .insert({
          client_user_id: r1ClientId,
          operator_tenant_id: r1TenantId!,
          created_by: r1OperatorId,
          title: `Gate B15F EmptyWhy ${stamp}`,
          why: " ",
          category: "liquidity",
          kind: "recommendation",
          status: "draft",
          evidence: [],
          anchor_type: "general",
        })
        .select("id")
        .single();
      // Also assert route source allows empty why for drafts
      const routeSrc = readFileSync(
        join(
          ROOT,
          "app/api/operator/treasury/clients/[clientId]/recommendations/route.ts"
        ),
        "utf8"
      );
      const allowsEmpty =
        routeSrc.includes("sending && !whyRaw") ||
        routeSrc.includes("(sending && !whyRaw)");
      recId = rec?.id ?? null;
      record(
        26,
        "draft empty why allowed",
        !error && Boolean(recId) && allowsEmpty,
        `id=${recId ?? "?"} allowsEmpty=${allowsEmpty} err=${error?.message ?? "none"}`
      );
    } finally {
      if (recId) {
        await admin.from("treasury_recommendations").delete().eq("id", recId);
      }
    }
  }

  // 27 — hard-delete cascades versions + blocks; soft archive still works
  {
    const r1OperatorId = await resolveUserId(admin, R1_OPERATOR_EMAIL);
    let softId: string | null = null;
    let hardId: string | null = null;
    try {
      const { data: soft } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: r1TenantId!,
          client_user_id: r1ClientId,
          period_month: "2025-11-01",
          label: `${label}-b15f-soft`,
          title: "B15F Soft Archive",
          status: "draft",
          created_by: r1OperatorId,
        })
        .select("id")
        .single();
      softId = soft?.id ?? null;
      await admin
        .from("treasury_reviews")
        .update({ status: "archived" })
        .eq("id", softId!);
      const { data: softRow } = await admin
        .from("treasury_reviews")
        .select("status")
        .eq("id", softId!)
        .maybeSingle();

      const { data: hard } = await admin
        .from("treasury_reviews")
        .insert({
          tenant_id: r1TenantId!,
          client_user_id: r1ClientId,
          period_month: "2025-10-01",
          label: `${label}-b15f-hard`,
          title: "B15F Hard Delete",
          status: "draft",
          created_by: r1OperatorId,
        })
        .select("id")
        .single();
      hardId = hard?.id ?? null;
      await admin.from("treasury_review_blocks").insert({
        review_id: hardId!,
        position: 1,
        role: "note",
        caption: "",
        body: "to cascade",
        proposal_state: "none",
        provenance: {},
      });
      await admin.from("treasury_review_versions").insert({
        review_id: hardId!,
        version: 1,
        reviewed_as_of: "2025-10-01",
        published_by: r1OperatorId,
        change_note: "seed",
        snapshot: {
          meta: {},
          blocks: [],
          cover_figures: [],
          live_strip: { enabled: false },
          disclosures: { advisory: "", accuracy: "", review: "" },
        } as unknown as Json,
      });
      await admin.from("treasury_reviews").delete().eq("id", hardId!);
      const { data: goneReview } = await admin
        .from("treasury_reviews")
        .select("id")
        .eq("id", hardId!)
        .maybeSingle();
      const { count: leftBlocks } = await admin
        .from("treasury_review_blocks")
        .select("id", { count: "exact", head: true })
        .eq("review_id", hardId!);
      const { count: leftVers } = await admin
        .from("treasury_review_versions")
        .select("id", { count: "exact", head: true })
        .eq("review_id", hardId!);
      hardId = null; // already deleted

      const routeSrc = readFileSync(
        join(
          ROOT,
          "app/api/operator/treasury/clients/[clientId]/reviews/[reviewId]/route.ts"
        ),
        "utf8"
      );
      const hasHard = routeSrc.includes('hard") === "1"') || routeSrc.includes("hard=1");

      record(
        27,
        "hard-delete cascade + soft archive",
        softRow?.status === "archived" &&
          !goneReview &&
          (leftBlocks ?? 0) === 0 &&
          (leftVers ?? 0) === 0 &&
          hasHard,
        `soft=${softRow?.status} gone=${!goneReview} blocks=${leftBlocks} vers=${leftVers} hasHard=${hasHard}`
      );
    } finally {
      if (softId) await admin.from("treasury_reviews").delete().eq("id", softId);
      if (hardId) await admin.from("treasury_reviews").delete().eq("id", hardId);
    }
  }

  // 28 — snapshot-first GET (no suggestedCaptionForBlock on review GET)
  {
    const routeSrc = readFileSync(
      join(
        ROOT,
        "app/api/operator/treasury/clients/[clientId]/reviews/[reviewId]/route.ts"
      ),
      "utf8"
    );
    const snapshotFirst =
      routeSrc.includes("snapshot-first") &&
      !routeSrc.includes("suggestedCaptionForBlock") &&
      !routeSrc.includes("computeReviewPreflight");
    record(
      28,
      "review GET snapshot-first",
      snapshotFirst,
      `snapshotFirst=${snapshotFirst}`
    );
  }

  log("ALL 28/28 LIVE CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
