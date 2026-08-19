/**
 * Spec B2 gate — OAuth discovery, DCR, headless PKCE code mint, MCP auth/scopes/isolation.
 * No Playwright — manual "Connect in Claude + Allow" is acceptance-only.
 *
 * Prereqs:
 *   npm run test:seed:mcp-testers
 *   MCP_OAUTH_ISSUER + MCP_OAUTH_SIGNING_SECRET in .env.local (dev server must match)
 *   Dev server running on MCP_OAUTH_ISSUER (default http://localhost:3000)
 *
 * Usage: npm run gate:mcp-b2
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
import { CLAUDE_MCP_REDIRECT } from "../lib/mcp/oauth-config";
import { mintAuthorizationCode } from "../lib/mcp/oauth-codes";
import { registerOAuthClient } from "../lib/mcp/oauth-clients";
import {
  codeChallengeS256,
  generateCodeVerifier,
} from "../lib/mcp/oauth-pkce";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");
const BOOK_SIZE = 3;

type OperatorKey = "tim" | "ana";
type OperatorFixture = {
  email: string;
  operatorId: string;
  tenantId: string;
  clientIds: string[];
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

function issuerBase(): string {
  const fromEnv = process.env.MCP_OAUTH_ISSUER?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const gate = process.env.MCP_GATE_URL ?? "http://localhost:3000/api/mcp";
  return gate.replace(/\/api\/mcp\/?$/, "");
}

function log(msg: string) {
  console.log(`[gate-b2] ${msg}`);
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

function normalizeOperator(raw: Record<string, unknown>): OperatorFixture {
  const legacy = raw.clientId as string | undefined;
  const clientIds =
    (raw.clientIds as string[] | undefined) ?? (legacy ? [legacy] : []);
  return {
    email: String(raw.email),
    operatorId: String(raw.operatorId),
    tenantId: String(raw.tenantId),
    clientIds,
  };
}

function loadFixtures(): Record<OperatorKey, OperatorFixture> {
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
  const url = process.env.MCP_GATE_URL ?? "http://localhost:3000/api/mcp";
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: { token: async () => token },
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "gate-mcp-b2", version: "1.0.0" });
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

async function fetchJson(path: string) {
  const base = issuerBase();
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function postToken(body: Record<string, string>) {
  const base = issuerBase();
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function setsDisjoint(a: string[], b: string[]) {
  const bs = new Set(b);
  return a.every((id) => !bs.has(id));
}

async function exchangeCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const { status, json } = await postToken({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if (status !== 200 || typeof json.access_token !== "string") {
    throw new Error(`Token exchange failed (${status}): ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

async function main() {
  loadEnvLocal();
  if (!process.env.MCP_OAUTH_SIGNING_SECRET?.trim()) {
    throw new Error(
      "MCP_OAUTH_SIGNING_SECRET missing — add to .env.local (dev server must use same value)"
    );
  }
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(`Missing ${TOKENS_PATH} — run npm run test:seed:mcp-testers`);
  }

  const { tim, ana } = loadFixtures();
  const admin = adminClient();
  const timPrimary = tim.clientIds[0]!;
  const anaForeign = ana.clientIds[0]!;
  const redirectUri = CLAUDE_MCP_REDIRECT;

  {
    const { status, body } = await fetchJson(
      "/.well-known/oauth-protected-resource"
    );
    const b = body as { resource?: string; authorization_servers?: string[] };
    const ok =
      status === 200 &&
      typeof b.resource === "string" &&
      Array.isArray(b.authorization_servers) &&
      b.authorization_servers.length > 0;
    record(
      1,
      ".well-known/oauth-protected-resource (rewrite)",
      ok,
      ok ? `resource=${b.resource}` : `status=${status} body=${JSON.stringify(body).slice(0, 120)}`
    );
  }

  {
    const { status, body } = await fetchJson(
      "/.well-known/oauth-authorization-server"
    );
    const b = body as {
      issuer?: string;
      authorization_endpoint?: string;
      token_endpoint?: string;
      registration_endpoint?: string;
      code_challenge_methods_supported?: string[];
    };
    const ok =
      status === 200 &&
      typeof b.issuer === "string" &&
      typeof b.token_endpoint === "string" &&
      b.code_challenge_methods_supported?.includes("S256");
    record(
      2,
      ".well-known/oauth-authorization-server (rewrite)",
      ok,
      ok ? `issuer=${b.issuer}` : `status=${status}`
    );
  }

  {
    const { status, body } = await fetchJson(
      "/api/oauth/well-known/oauth-authorization-server"
    );
    const b = body as { issuer?: string };
    record(
      3,
      "Direct AS metadata route",
      status === 200 && typeof b.issuer === "string",
      status === 200 ? `issuer=${b.issuer}` : `status=${status}`
    );
  }

  let clientId: string;
  {
    const res = await fetch(`${issuerBase()}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "gate-b2",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    });
    const json = (await res.json()) as { client_id?: string };
    const ok = res.status === 201 && typeof json.client_id === "string";
    if (!ok) {
      record(4, "DCR allowed redirect", false, JSON.stringify(json));
    } else {
      clientId = json.client_id!;
      record(4, "DCR allowed redirect", true, `client_id=${clientId.slice(0, 12)}…`);
    }
  }

  {
    const bad = await registerOAuthClient(admin, {
      redirect_uris: ["https://evil.example/callback"],
      client_name: "gate-b2-bad",
    });
    record(
      5,
      "DCR rejects bad redirect",
      !bad.ok,
      bad.ok ? "unexpected success" : String(bad.error)
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);
  let authCode: string;

  {
    const minted = await mintAuthorizationCode(admin, {
      clientId: clientId!,
      operatorUserId: tim.operatorId,
      tenantId: tim.tenantId,
      scope: "treasury:read treasury:write",
      redirectUri,
      codeChallenge: challenge,
    });
    authCode = minted.code;
    record(6, "Headless auth code mint", true, `expires ${minted.expiresAt}`);
  }

  let accessToken: string;
  {
    accessToken = await exchangeCode({
      code: authCode,
      clientId: clientId!,
      redirectUri,
      codeVerifier: verifier,
    });
    record(7, "PKCE token exchange", true, "access_token received");
  }

  {
    const badVerifier = generateCodeVerifier();
    const minted2 = await mintAuthorizationCode(admin, {
      clientId: clientId!,
      operatorUserId: tim.operatorId,
      tenantId: tim.tenantId,
      scope: "treasury:read treasury:write",
      redirectUri,
      codeChallenge: codeChallengeS256(badVerifier),
    });
    const { status, json } = await postToken({
      grant_type: "authorization_code",
      code: minted2.code,
      client_id: clientId!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    record(
      8,
      "Wrong PKCE verifier rejected",
      status >= 400 && json.error === "invalid_grant",
      String(json.error ?? status)
    );
  }

  {
    const { client, transport } = await mcpClient(accessToken);
    const listed = (await callTool(client, "list_clients")) as Array<{ id: string }>;
    const ids = listed.map((c) => c.id).sort();
    const expected = [...tim.clientIds].sort();
    const ok =
      ids.length === BOOK_SIZE &&
      ids.every((id, i) => id === expected[i]) &&
      setsDisjoint(ids, ana.clientIds);
    record(
      9,
      "OAuth token list_clients (Tim book)",
      ok,
      `Tim sees ${ids.length} client(s); disjoint from Ana`
    );
    await transport.close();
  }

  {
    const { client, transport } = await mcpClient(accessToken);
    let denied = false;
    try {
      await callTool(client, "get_client", { client_id: anaForeign });
    } catch {
      denied = true;
    }
    record(
      10,
      "Cross-operator isolation (Tim→Ana client)",
      denied,
      denied ? "MCP error as expected" : "Expected grant error"
    );
    await transport.close();
  }

  {
    const readVerifier = generateCodeVerifier();
    const readChallenge = codeChallengeS256(readVerifier);
    const minted = await mintAuthorizationCode(admin, {
      clientId: clientId!,
      operatorUserId: tim.operatorId,
      tenantId: tim.tenantId,
      scope: "treasury:read",
      redirectUri,
      codeChallenge: readChallenge,
    });
    const readToken = await exchangeCode({
      code: minted.code,
      clientId: clientId!,
      redirectUri,
      codeVerifier: readVerifier,
    });
    const { client, transport } = await mcpClient(readToken);
    let writeDenied = false;
    try {
      await callTool(client, "submit_results", {
        client_id: timPrimary,
        results: { schema_version: "summit.results/v1" },
      });
    } catch (e) {
      writeDenied = /Insufficient scope|treasury:write/i.test(String(e));
    }
    record(
      11,
      "Read-only scope rejects submit_results",
      writeDenied,
      writeDenied ? "scope error" : "Expected treasury:write denial"
    );
    await transport.close();
  }

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(12, "npm run build", true, "green");

  log("");
  log("=== Spec B2 gate: ALL PASS ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B2 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
