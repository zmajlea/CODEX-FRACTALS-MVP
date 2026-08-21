/**
 * Spec B9 — mint a confidential OAuth client for ChatGPT user-defined connector.
 *
 * Usage:
 *   npx tsx scripts/mint-oauth-client.ts --name "ChatGPT connector" --redirect "https://chatgpt.com/connector/oauth/<token>"
 *
 * Prints client_id + client_secret once. Secret is stored hashed only.
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import type { Database } from "../lib/database.types";
import { isRedirectUriAllowed } from "../lib/mcp/oauth-config";
import {
  generateClientId,
  generateClientSecret,
  hashOAuthSecret,
} from "../lib/mcp/oauth-clients";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

function parseArgs(argv: string[]) {
  let name = "ChatGPT MCP connector";
  let redirect = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--name" && argv[i + 1]) {
      name = argv[++i]!;
    } else if (a === "--redirect" && argv[i + 1]) {
      redirect = argv[++i]!;
    } else if (a === "--help" || a === "-h") {
      console.log(
        'Usage: npx tsx scripts/mint-oauth-client.ts --name "…" --redirect "https://chatgpt.com/connector/oauth/…"'
      );
      process.exit(0);
    }
  }
  return { name, redirect };
}

async function main() {
  loadEnvLocal();
  const { name, redirect } = parseArgs(process.argv.slice(2));
  if (!redirect) {
    console.error("Missing --redirect");
    process.exit(1);
  }
  if (!isRedirectUriAllowed(redirect)) {
    console.error(`redirect_uri not allowed: ${redirect}`);
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const { error } = await admin.from("oauth_clients").insert({
    client_id: clientId,
    client_secret_hash: hashOAuthSecret(clientSecret),
    client_name: name,
    redirect_uris: [redirect],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "client_secret_post",
  });

  if (error) {
    console.error("insert failed:", error.message);
    process.exit(1);
  }

  console.log("");
  console.log("OAuth confidential client minted (paste into ChatGPT once):");
  console.log(`  client_id:     ${clientId}`);
  console.log(`  client_secret: ${clientSecret}`);
  console.log(`  redirect_uri:  ${redirect}`);
  console.log(`  auth_method:   client_secret_post`);
  console.log("");
  console.log("Secret will not be shown again. MCP URL: <issuer>/api/mcp");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
