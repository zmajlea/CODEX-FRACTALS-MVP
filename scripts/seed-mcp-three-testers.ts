/**
 * Spec B1 Amendment 1 — three MCP testers, each on its own tenant with one client grant.
 * Prerequisite: npm run test:seed:ana-gate (clients 1–4 exist).
 *
 * Usage: npx tsx scripts/seed-mcp-three-testers.ts
 * Writes scripts/.mcp-gate-tokens.json (local gate credentials).
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";
import {
  generateOperatorToken,
  hashOperatorToken,
} from "../lib/mcp/auth";

const ANA_GATE_CLIENTS = [
  { email: "ana_gate_client_1@codexone.test", displayName: "Ana Gate Client 1" },
  { email: "ana_gate_client_2@codexone.test", displayName: "Ana Gate Client 2" },
  { email: "ana_gate_client_3@codexone.test", displayName: "Ana Gate Client 3" },
  { email: "ana_gate_client_4@codexone.test", displayName: "Ana Gate Client 4" },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const MCP_TESTERS = [
  {
    key: "leander",
    email: "mcp_gate_leander@codexone.test",
    displayName: "MCP Gate Leander",
    tenantSlug: "mcp-gate-leander",
    tenantName: "MCP Gate Leander",
    clientIndex: 0,
  },
  {
    key: "ana",
    email: "mcp_gate_ana@codexone.test",
    displayName: "MCP Gate Ana",
    tenantSlug: "mcp-gate-ana",
    tenantName: "MCP Gate Ana",
    clientIndex: 1,
  },
  {
    key: "tim",
    email: "mcp_gate_tim@codexone.test",
    displayName: "MCP Gate Tim",
    tenantSlug: "mcp-gate-tim",
    tenantName: "MCP Gate Tim",
    clientIndex: 2,
  },
] as const;

const MCP_PASSWORD = "mcp_gate_2026!";

function log(step: string, detail = "") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}${detail ? ` — ${detail}` : ""}`);
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

async function ensureAuthUser(
  admin: ReturnType<typeof createClient>,
  email: string,
  password: string,
  displayName: string
) {
  let user = await findAuthUserByEmail(admin, email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    user = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (error) throw new Error(`updateUser: ${error.message}`);
  }

  const { error: profileErr } = await admin.from("users").upsert({
    id: user.id,
    email,
    display_name: displayName,
  });
  if (profileErr) throw new Error(`users upsert: ${profileErr.message}`);
  return user;
}

async function ensureTenant(
  admin: ReturnType<typeof createClient>,
  slug: string,
  name: string
) {
  const { data: existing } = await admin
    .from("tenants")
    .select("id")
    .eq("domain_slug", slug)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("tenants")
    .insert({
      name,
      domain_slug: slug,
      brand_color_hex: "#EBC06D",
      available_credits: 100,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`tenant: ${error?.message}`);
  return created.id;
}

async function main() {
  loadEnvLocal(join(ROOT, ".env.local"));

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

  const { data: treasuryModule, error: modErr } = await admin
    .from("modules")
    .select("id")
    .eq("slug", "treasury")
    .maybeSingle();
  if (modErr || !treasuryModule) throw new Error("treasury module missing");

  const clientIds: string[] = [];
  for (const c of ANA_GATE_CLIENTS) {
    const user = await findAuthUserByEmail(admin, c.email);
    if (!user) {
      console.error(`Missing client ${c.email} — run npm run test:seed:ana-gate`);
      process.exit(1);
    }
    clientIds.push(user.id);
  }

  const out: Record<
    string,
    { email: string; operatorId: string; tenantId: string; clientId: string; token: string }
  > = {};

  for (const tester of MCP_TESTERS) {
    log("Setup", tester.email);
    const tenantId = await ensureTenant(
      admin,
      tester.tenantSlug,
      tester.tenantName
    );
    const operator = await ensureAuthUser(
      admin,
      tester.email,
      MCP_PASSWORD,
      tester.displayName
    );

    const { data: existingRole } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", operator.id)
      .eq("role", "operator")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!existingRole) {
      const { error } = await admin.from("user_roles").insert({
        user_id: operator.id,
        role: "operator",
        tenant_id: tenantId,
        granted_by: operator.id,
      });
      if (error) throw new Error(`user_roles: ${error.message}`);
    }

    await admin.from("operator_modules").upsert(
      {
        distributor_tenant_id: tenantId,
        module_id: treasuryModule.id,
        allowed: true,
        granted_by: operator.id,
      },
      { onConflict: "distributor_tenant_id,module_id" }
    );

    const clientId = clientIds[tester.clientIndex]!;
    const clientEmail = ANA_GATE_CLIENTS[tester.clientIndex]!.email;

    const { data: grantRow } = await admin
      .from("client_module_access")
      .select("id, status")
      .eq("client_user_id", clientId)
      .eq("distributor_tenant_id", tenantId)
      .eq("module_id", treasuryModule.id)
      .maybeSingle();

    if (grantRow?.status === "active") {
      log("Grant", `active ${clientEmail} on ${tester.tenantSlug}`);
    } else if (grantRow) {
      await admin
        .from("client_module_access")
        .update({ status: "active", granted_at: new Date().toISOString() })
        .eq("id", grantRow.id);
    } else {
      await admin.from("client_module_access").insert({
        client_user_id: clientId,
        distributor_tenant_id: tenantId,
        module_id: treasuryModule.id,
        status: "active",
        granted_by: operator.id,
      });
    }

    await admin.from("treasury_client_operator_profile").upsert(
      {
        distributor_tenant_id: tenantId,
        client_user_id: clientId,
        industry: null,
        next_note: null,
        watch_note: null,
        attention_reason: null,
      },
      { onConflict: "distributor_tenant_id,client_user_id" }
    );

    await admin
      .from("operator_api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("operator_user_id", operator.id)
      .is("revoked_at", null);

    const raw = generateOperatorToken();
    const { error: tokErr } = await admin.from("operator_api_tokens").insert({
      operator_user_id: operator.id,
      tenant_id: tenantId,
      token_hash: hashOperatorToken(raw),
      label: `mcp-gate-${tester.key}`,
    });
    if (tokErr) throw new Error(tokErr.message);

    out[tester.key] = {
      email: tester.email,
      operatorId: operator.id,
      tenantId,
      clientId,
      token: raw,
    };
    log("Token", `minted ${tester.key}`);
  }

  const outPath = join(__dirname, ".mcp-gate-tokens.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
