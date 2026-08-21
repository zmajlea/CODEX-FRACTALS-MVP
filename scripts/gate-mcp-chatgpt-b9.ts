/**
 * Spec B9 gate — ChatGPT MCP connector (redirect allowlist + confidential client).
 *
 * Prereqs: same as gate:mcp-b2 (seed tokens, OAuth env, dev on MCP_OAUTH_ISSUER).
 * Usage: npm run gate:mcp-chatgpt
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
import {
  CLAUDE_MCP_REDIRECT,
  isRedirectUriAllowed,
} from "../lib/mcp/oauth-config";
import { mintAuthorizationCode } from "../lib/mcp/oauth-codes";
import {
  assertClientAuth,
  registerOAuthClient,
} from "../lib/mcp/oauth-clients";
import {
  codeChallengeS256,
  generateCodeVerifier,
} from "../lib/mcp/oauth-pkce";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOKENS_PATH = join(__dirname, ".mcp-gate-tokens.json");
const CHATGPT_REDIRECT = "https://chatgpt.com/connector/oauth/abc123gate";

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
  const gate = process.env.MCP_GATE_URL ?? "http://localhost:14000/api/mcp";
  return gate.replace(/\/api\/mcp\/?$/, "");
}

function log(msg: string) {
  console.log(`[gate-mcp-b9] ${msg}`);
}

function record(id: number, name: string, ok: boolean, detail: string) {
  results.push({ id, name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${id}. ${name} — ${detail}`);
  if (!ok) throw new Error(`Check ${id} failed: ${detail}`);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

function loadTim() {
  const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  const t = raw.tim!;
  const legacy = t.clientId as string | undefined;
  const clientIds =
    (t.clientIds as string[] | undefined) ?? (legacy ? [legacy] : []);
  return {
    operatorId: String(t.operatorId),
    tenantId: String(t.tenantId),
    clientIds,
  };
}

async function postToken(body: Record<string, string>) {
  const res = await fetch(`${issuerBase()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function parseToolText(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  if (result.isError) {
    throw new Error(result.content?.[0]?.text ?? "MCP error");
  }
  const text = result.content?.[0]?.text;
  if (!text) throw new Error("Empty MCP tool response");
  return JSON.parse(text) as unknown;
}

async function main() {
  loadEnvLocal();
  if (!process.env.MCP_OAUTH_SIGNING_SECRET?.trim()) {
    throw new Error("MCP_OAUTH_SIGNING_SECRET missing");
  }
  if (!existsSync(TOKENS_PATH)) {
    throw new Error("Missing .mcp-gate-tokens.json — run test:seed:mcp-testers");
  }

  const admin = adminClient();
  const tim = loadTim();
  const cleanupClientIds: string[] = [];

  // 1. Allowlist matrix
  {
    const cases: Array<[string, boolean]> = [
      [CLAUDE_MCP_REDIRECT, true],
      ["http://localhost:8787/callback", true],
      [CHATGPT_REDIRECT, true],
      ["http://chatgpt.com/connector/oauth/x", false],
      ["https://chatgpt.com/other", false],
      ["https://chatgpt.com.evil.com/connector/oauth/x", false],
      ["https://notchatgpt.com/connector/oauth/x", false],
      ["https://evilchatgpt.com/connector/oauth/x", false],
    ];
    const fails = cases.filter(([uri, want]) => isRedirectUriAllowed(uri) !== want);
    record(
      1,
      "isRedirectUriAllowed matrix",
      fails.length === 0,
      fails.length
        ? fails.map(([u, w]) => `${u} want=${w}`).join("; ")
        : `${cases.length} cases`
    );
  }

  // 2. DCR with ChatGPT redirect
  {
    const reg = await registerOAuthClient(admin, {
      redirect_uris: [CHATGPT_REDIRECT],
      client_name: "gate-b9-dcr",
      token_endpoint_auth_method: "none",
    });
    if (reg.ok) cleanupClientIds.push(reg.client_id);
    record(
      2,
      "DCR with ChatGPT redirect",
      reg.ok,
      reg.ok ? `client_id=${reg.client_id}` : reg.error
    );
  }

  // 3. Confidential client_secret_post + PKCE; wrong secret rejected
  {
    const reg = await registerOAuthClient(admin, {
      redirect_uris: [CHATGPT_REDIRECT],
      client_name: "gate-b9-confidential",
      token_endpoint_auth_method: "client_secret_post",
    });
    if (!reg.ok || !reg.client_secret) {
      record(3, "confidential client_secret_post exchange", false, "register failed");
      return;
    }
    cleanupClientIds.push(reg.client_id);

    const badAuth = await assertClientAuth(admin, reg.client_id, "wrong-secret");
    const goodAuth = await assertClientAuth(
      admin,
      reg.client_id,
      reg.client_secret
    );

    const verifier = generateCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    const minted = await mintAuthorizationCode(admin, {
      clientId: reg.client_id,
      redirectUri: CHATGPT_REDIRECT,
      operatorUserId: tim.operatorId,
      tenantId: tim.tenantId,
      scope: "treasury:read treasury:write",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    });

    const wrong = await postToken({
      grant_type: "authorization_code",
      code: minted.code,
      client_id: reg.client_id,
      client_secret: "wrong-secret",
      redirect_uri: CHATGPT_REDIRECT,
      code_verifier: verifier,
    });

    // Mint a fresh code after wrong attempt may have left first code unconsumed
    // (auth fails before consume). Re-mint for success path.
    const verifier2 = generateCodeVerifier();
    const challenge2 = codeChallengeS256(verifier2);
    const minted2 = await mintAuthorizationCode(admin, {
      clientId: reg.client_id,
      redirectUri: CHATGPT_REDIRECT,
      operatorUserId: tim.operatorId,
      tenantId: tim.tenantId,
      scope: "treasury:read treasury:write",
      codeChallenge: challenge2,
      codeChallengeMethod: "S256",
    });

    const okTok = await postToken({
      grant_type: "authorization_code",
      code: minted2.code,
      client_id: reg.client_id,
      client_secret: reg.client_secret,
      redirect_uri: CHATGPT_REDIRECT,
      code_verifier: verifier2,
    });

    const access = okTok.json.access_token as string | undefined;
    let listOk = false;
    if (access) {
      const url = process.env.MCP_GATE_URL ?? `${issuerBase()}/api/mcp`;
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        authProvider: { token: async () => access },
        requestInit: { headers: { Authorization: `Bearer ${access}` } },
      });
      const client = new Client({ name: "gate-b9", version: "1.0.0" });
      await client.connect(transport);
      const raw = await client.callTool({
        name: "list_clients",
        arguments: {},
      });
      const parsed = parseToolText(
        raw as {
          content?: Array<{ type: string; text?: string }>;
          isError?: boolean;
        }
      ) as Array<{ id: string }> | { clients?: Array<{ id: string }> };
      const ids = Array.isArray(parsed)
        ? parsed.map((c) => c.id)
        : (parsed.clients ?? []).map((c) => c.id);
      listOk =
        ids.length === tim.clientIds.length &&
        tim.clientIds.every((id) => ids.includes(id));
      try {
        await client.close();
      } catch {
        /* */
      }
    }

    // AS metadata still advertises both methods
    const meta = await fetch(
      `${issuerBase()}/.well-known/oauth-authorization-server`
    );
    const metaJson = (await meta.json()) as {
      token_endpoint_auth_methods_supported?: string[];
    };
    const methods = metaJson.token_endpoint_auth_methods_supported ?? [];
    const metaOk =
      methods.includes("none") && methods.includes("client_secret_post");

    record(
      3,
      "confidential client_secret_post + PKCE + isolation",
      !badAuth.ok &&
        goodAuth.ok &&
        wrong.status === 401 &&
        okTok.status === 200 &&
        typeof access === "string" &&
        listOk &&
        metaOk,
      `badAuth=${badAuth.ok} goodAuth=${goodAuth.ok} wrong=${wrong.status} ok=${okTok.status} listOk=${listOk} meta=${methods.join(",")}`
    );
  }

  // Cleanup oauth clients created by this gate
  for (const id of cleanupClientIds) {
    await admin.from("oauth_clients").delete().eq("client_id", id);
  }

  log("Re-running gate:mcp-b2 (Claude public+PKCE regression)…");
  execSync("npm run gate:mcp-b2", {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  record(4, "gate:mcp-b2 Claude regression", true, "green");

  log("Running npm run build…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  record(5, "npm run build", true, "green");

  // Static: /mcp rewrite present
  {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    record(
      6,
      "/mcp rewrite to /api/mcp",
      cfg.includes('source: "/mcp"') && cfg.includes('destination: "/api/mcp"'),
      "next.config.ts"
    );
  }

  log("");
  log("=== Spec B9 gate: ALL PASS ===");
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  log("");
  log("=== Spec B9 gate: FAILED ===");
  for (const r of results) {
    log(`  ${r.ok ? "✓" : "✗"} ${r.id}. ${r.name} — ${r.detail}`);
  }
  process.exit(1);
});
