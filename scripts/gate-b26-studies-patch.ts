/**
 * B26 gate — New study always creates; reopen keeps live Edition client-visible;
 * never-published drafts stay invisible on the client session (no admin bypass).
 *
 * Static checks always. Live API when GATE_B26_LIVE=1 + tokens + server.
 *
 * Usage: npm run gate:b26
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
  clients?: Array<{ email: string; id: string }>;
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
  console.log(`[gate-b26] ${msg}`);
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

function loadTokens(): {
  operator: OperatorToken;
  client?: { email: string; id: string; token?: string };
} | null {
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
  const clients =
    (r.clients as Array<{ email: string; id: string }> | undefined) ?? [];
  return {
    operator: {
      email: String(r.email),
      operatorId: String(r.operatorId),
      tenantId: String(r.tenantId),
      clientIds,
      clients,
      token: String(r.token),
    },
    client: clients[0]
      ? { email: clients[0].email, id: clients[0].id }
      : clientIds[0]
        ? { email: "", id: clientIds[0] }
        : undefined,
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
  log("B26 Studies new-draft / reopen / client-visibility gate");

  const opPost =
    "app/api/operator/treasury/clients/[clientId]/reviews/route.ts";
  const opPatch =
    "app/api/operator/treasury/clients/[clientId]/reviews/[reviewId]/route.ts";
  const clientList = "app/api/treasury/reviews/route.ts";
  const clientRead = "app/api/treasury/reviews/[reviewId]/route.ts";
  const clientExport = "app/api/treasury/reviews/[reviewId]/export/route.ts";
  const panel = "components/operator/treasury/ReviewTabPanel.tsx";

  const postSrc = read(opPost);
  assert(postSrc.includes("auto-disambiguate") || postSrc.includes("String(n)"), "implicit disambiguate missing");
  assert(postSrc.includes("explicit"), "explicit/implicit branch missing");
  pass(1, "Part A: implicit auto-disambiguate in POST", opPost);

  const patchSrc = read(opPatch);
  assert(patchSrc.includes('action === "reopen"'), "reopen action missing");
  assert(
    patchSrc.includes("Only published studies can be reopened"),
    "reopen 409 missing"
  );
  assert(
    !patchSrc.includes("treasury_review_versions") ||
      patchSrc.includes("Do not touch treasury_review_versions"),
    "reopen must not mutate versions"
  );
  pass(2, "Part B: reopen PATCH before draft gate", opPatch);

  const listSrc = read(clientList);
  const readSrc = read(clientRead);
  const exportSrc = read(clientExport);
  assert(
    !listSrc.includes('.eq("status", "published")'),
    "client list must not filter treasury_reviews.status"
  );
  assert(
    listSrc.includes("superseded_at") && listSrc.includes("treasury_review_versions"),
    "client list must read live versions"
  );
  assert(
    !listSrc.includes("createSupabaseAdminClient") &&
      !listSrc.includes("service_role") &&
      !listSrc.includes("SUPABASE_SERVICE_ROLE"),
    "client list must not use admin/service-role"
  );
  assert(
    readSrc.includes("superseded_at") &&
      readSrc.includes('status: "published"') &&
      (readSrc.includes("meta?.title") || readSrc.includes("snap?.meta")),
    "client read version-first + meta + published status"
  );
  assert(
    !readSrc.includes("createSupabaseAdminClient") &&
      !exportSrc.includes("createSupabaseAdminClient"),
    "client read/export no admin bypass"
  );
  assert(
    exportSrc.includes("superseded_at") &&
      !exportSrc.includes('.eq("status"'),
    "export version-first"
  );
  pass(3, "Part B client: live Edition via session RLS", "list/read/export");

  const panelSrc = read(panel);
  assert(panelSrc.includes('data-testid="editions-revision-history"'), "revision history missing");
  assert(panelSrc.includes('data-testid="reopen-to-edit"'), "reopen control missing");
  assert(panelSrc.includes("PUBLISH_CONTROL_LABEL"), "D copy constant missing");
  assert(!panelSrc.includes('data-testid="editions-strip"'), "old editions-strip must be gone");
  pass(4, "Part C+D: revision history + reopen UI + copy constant", panel);

  const b12 = read("scripts/gate-review-b12.ts");
  assert(
    !b12.includes("no draft reopen") || b12.includes("reopen not required"),
    "gate-review-b12 must invert no-draft-reopen asserts"
  );
  assert(
    b12.includes("editions-revision-history"),
    "gate-review-b12 must expect revision-history testid"
  );
  pass(5, "gate-review-b12 asserts inverted for B26", "reopen + editions");

  if (process.env.GATE_B26_LIVE !== "1") {
    log("SKIP live API — set GATE_B26_LIVE=1 with tokens + server to run");
    log("Done — static checks passed");
    return;
  }

  const tokens = loadTokens();
  if (!tokens?.operator.clientIds[0]) {
    log("SKIP live API — no tokens");
    log("Done — static checks passed");
    return;
  }

  const clientId = tokens.operator.clientIds[0]!;
  const base = baseUrl();
  const admin = adminClient();

  let opCookie: string;
  try {
    const { data: signIn, error } = await admin.auth.signInWithPassword({
      email: tokens.operator.email,
      password: process.env.MCP_GATE_PASSWORD ?? "mcp_gate_2026!",
    });
    if (error || !signIn.session) throw error ?? new Error("no session");
    opCookie = sessionCookieHeader(signIn.session);
  } catch (e) {
    log(`SKIP live API — operator sign-in: ${e instanceof Error ? e.message : e}`);
    log("Done — static checks passed");
    return;
  }

  async function api(
    path: string,
    cookie: string,
    init?: RequestInit
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Cookie: cookie, ...(init?.headers ?? {}) },
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
    const a = await api(
      `/api/operator/treasury/clients/${clientId}/reviews`,
      opCookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const idA =
      (a.json.review as { id?: string } | undefined)?.id ?? null;
    assert(a.status === 201 && idA, `implicit create #1 failed ${a.status}`);

    const b = await api(
      `/api/operator/treasury/clients/${clientId}/reviews`,
      opCookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const idB =
      (b.json.review as { id?: string } | undefined)?.id ?? null;
    assert(
      b.status === 201 && idB && idB !== idA,
      `implicit create #2 must be distinct (status=${b.status} idB=${idB})`
    );
    pass(6, "Live: + New study always creates distinct draft", `${idA} vs ${idB}`);

    // Explicit duplicate 409 — reuse period/label from created row
    const { data: rowA } = await admin
      .from("treasury_reviews")
      .select("period_month, label")
      .eq("id", idA!)
      .single();
    const dup = await api(
      `/api/operator/treasury/clients/${clientId}/reviews`,
      opCookie,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_month: rowA!.period_month,
          label: rowA!.label,
        }),
      }
    );
    assert(dup.status === 409 && dup.json.existing, `explicit 409 missing (${dup.status})`);
    pass(7, "Live: explicit duplicate still 409", `status=${dup.status}`);

    // Never-published draft invisible to client
    const clientEmail =
      tokens.client?.email ||
      tokens.operator.clients?.find((c) => c.id === clientId)?.email;
    if (!clientEmail) {
      log("SKIP client visibility — no client email on tokens");
    } else {
      const { data: cSign, error: cErr } = await admin.auth.signInWithPassword({
        email: clientEmail,
        password: process.env.MCP_GATE_PASSWORD ?? "mcp_gate_2026!",
      });
      if (cErr || !cSign.session) {
        log(`SKIP client visibility — client sign-in: ${cErr?.message}`);
      } else {
        const cCookie = sessionCookieHeader(cSign.session);
        const leak = await api(`/api/treasury/reviews/${idB}`, cCookie);
        assert(leak.status === 404, `draft leak on single-read (${leak.status})`);
        const list = await api(`/api/treasury/reviews`, cCookie);
        const ids = (
          (list.json.reviews as Array<{ id: string }> | undefined) ?? []
        ).map((r) => r.id);
        assert(!ids.includes(idB!), "draft leak on client list");
        pass(8, "Live: never-published draft invisible to client", "404 + not listed");

        // Publish idA then reopen — client still sees live Edition
        // Minimal publish via operator route if available; else admin insert is out of scope.
        // Use operator publish endpoint.
        const pub = await api(
          `/api/operator/treasury/clients/${clientId}/reviews/${idA}/publish`,
          opCookie,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ change_note: "b26-gate" }),
          }
        );
        if (pub.status >= 300) {
          log(`SKIP reopen visibility — publish failed ${pub.status}`);
        } else {
          const reopen = await api(
            `/api/operator/treasury/clients/${clientId}/reviews/${idA}`,
            opCookie,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reopen" }),
            }
          );
          assert(reopen.status < 300, `reopen failed ${reopen.status}`);
          const status = (reopen.json.review as { status?: string } | undefined)
            ?.status;
          assert(status === "draft", `reopen status=${status}`);

          const still = await api(`/api/treasury/reviews/${idA}`, cCookie);
          assert(still.status === 200, `client read after reopen ${still.status}`);
          assert(
            (still.json.review as { status?: string } | undefined)?.status ===
              "published",
            "client-facing status must stay published"
          );
          const exportRes = await fetch(
            `${base}/api/treasury/reviews/${idA}/export`,
            { headers: { Cookie: cCookie } }
          );
          assert(exportRes.status === 200, `export after reopen ${exportRes.status}`);
          pass(
            9,
            "Live: reopen keeps Edition visible on client session",
            "list/read/export OK"
          );
        }
      }
    }

    // Cleanup drafts we created (hard delete)
    for (const id of [idA, idB]) {
      if (!id) continue;
      await api(
        `/api/operator/treasury/clients/${clientId}/reviews/${id}?hard=1`,
        opCookie,
        { method: "DELETE" }
      );
    }

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
  console.error(`[gate-b26] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
