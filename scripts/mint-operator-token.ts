/**
 * Spec B1 — mint a dev bearer token for an operator (hash stored only).
 * Usage: npx tsx scripts/mint-operator-token.ts <operator-email> [label]
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import {
  generateOperatorToken,
  hashOperatorToken,
} from "../lib/mcp/auth";

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
    /* optional */
  }
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (hit) return hit;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function main() {
  loadEnvLocal();
  const email = process.argv[2];
  const label = process.argv[3] ?? "dev";
  if (!email) {
    console.error("Usage: npx tsx scripts/mint-operator-token.ts <email> [label]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const user = await findAuthUserByEmail(admin, email);
  if (!user) {
    console.error(`No auth user for ${email}`);
    process.exit(1);
  }

  const { data: role, error: roleErr } = await admin
    .from("user_roles")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("role", "operator")
    .limit(1)
    .maybeSingle();

  if (roleErr || !role?.tenant_id) {
    console.error("User is not an operator with a tenant");
    process.exit(1);
  }

  const raw = generateOperatorToken();
  const tokenHash = hashOperatorToken(raw);

  const { error } = await admin.from("operator_api_tokens").insert({
    operator_user_id: user.id,
    tenant_id: role.tenant_id,
    token_hash: tokenHash,
    label,
  });

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.log(`Operator: ${email}`);
  console.log(`Tenant:   ${role.tenant_id}`);
  console.log(`Label:    ${label}`);
  console.log("");
  console.log("Bearer token (shown once — store securely):");
  console.log(raw);
  console.log("");
  console.log(
    `Connect: npx mcp-remote ${process.env.MCP_GATE_URL ?? "http://localhost:3000/api/mcp"} --header "Authorization: Bearer ${raw}"`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
