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
import { previewMetricValue } from "../lib/treasury/metrics-eval";
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

  log("ALL 17/17 LIVE CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
