/**
 * Spec B1 — MCP operator books: Tim + Ana, each with ~3 demo clients on its own tenant.
 * Each client gets the ana-gate FFM demo book (transactions, categories, rules).
 * Client sets do not overlap across operators.
 *
 * Usage: npm run test:seed:mcp-testers
 * Writes scripts/.mcp-gate-tokens.json (gitignored) and prints bearer tokens once.
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
import { seedAnaGateDemoBook } from "./lib/seed-ana-gate-demo-book";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MCP_PASSWORD = "mcp_gate_2026!";
const BOOK_SIZE = 3;

export const MCP_OPERATORS = [
  {
    key: "tim",
    email: "mcp_gate_tim@codexone.test",
    displayName: "MCP Gate Tim",
    tenantSlug: "mcp-gate-tim",
    tenantName: "MCP Gate Tim",
    clients: [
      { email: "mcp_tim_lakeside@codexone.test", displayName: "Tim Book — Lakeside" },
      { email: "mcp_tim_summit@codexone.test", displayName: "Tim Book — Summit" },
      { email: "mcp_tim_northstar@codexone.test", displayName: "Tim Book — Northstar" },
    ],
  },
  {
    key: "ana",
    email: "mcp_gate_ana@codexone.test",
    displayName: "MCP Gate Ana",
    tenantSlug: "mcp-gate-ana",
    tenantName: "MCP Gate Ana",
    clients: [
      { email: "mcp_ana_harbor@codexone.test", displayName: "Ana Book — Harbor" },
      { email: "mcp_ana_ridge@codexone.test", displayName: "Ana Book — Ridge" },
      { email: "mcp_ana_valley@codexone.test", displayName: "Ana Book — Valley" },
    ],
  },
] as const;

/** @deprecated use MCP_OPERATORS */
export const MCP_TESTERS = MCP_OPERATORS;

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

async function revokeAllTokensForEmail(
  admin: ReturnType<typeof createClient>,
  email: string
) {
  const user = await findAuthUserByEmail(admin, email);
  if (!user) return;
  await admin
    .from("operator_api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("operator_user_id", user.id)
    .is("revoked_at", null);
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

  // Retire legacy single-client Leander tester
  await revokeAllTokensForEmail(admin, "mcp_gate_leander@codexone.test");

  const out: Record<
    string,
    {
      email: string;
      operatorId: string;
      tenantId: string;
      clientIds: string[];
      clients: Array<{ email: string; id: string; displayName: string }>;
      token: string;
    }
  > = {};

  for (const op of MCP_OPERATORS) {
    if (op.clients.length !== BOOK_SIZE) {
      throw new Error(`Expected ${BOOK_SIZE} clients for ${op.key}`);
    }

    log("Operator", op.email);
    const tenantId = await ensureTenant(admin, op.tenantSlug, op.tenantName);
    const operator = await ensureAuthUser(
      admin,
      op.email,
      MCP_PASSWORD,
      op.displayName
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

    const clientRows: Array<{ email: string; id: string; displayName: string }> =
      [];

    for (const clientDef of op.clients) {
      log("Client", clientDef.email);
      const client = await ensureAuthUser(
        admin,
        clientDef.email,
        MCP_PASSWORD,
        clientDef.displayName
      );

      const { data: grantRow } = await admin
        .from("client_module_access")
        .select("id, status")
        .eq("client_user_id", client.id)
        .eq("distributor_tenant_id", tenantId)
        .eq("module_id", treasuryModule.id)
        .maybeSingle();

      if (grantRow?.status === "active") {
        log("Grant", "active");
      } else if (grantRow) {
        await admin
          .from("client_module_access")
          .update({ status: "active", granted_at: new Date().toISOString() })
          .eq("id", grantRow.id);
      } else {
        await admin.from("client_module_access").insert({
          client_user_id: client.id,
          distributor_tenant_id: tenantId,
          module_id: treasuryModule.id,
          status: "active",
          granted_by: operator.id,
        });
      }

      await admin.from("treasury_client_operator_profile").upsert(
        {
          distributor_tenant_id: tenantId,
          client_user_id: client.id,
          industry: null,
          next_note: null,
          watch_note: null,
          attention_reason: null,
        },
        { onConflict: "distributor_tenant_id,client_user_id" }
      );

      const book = await seedAnaGateDemoBook(
        admin,
        client.id,
        operator.id,
        { log: (m) => log("Book", `${clientDef.displayName}: ${m}`) }
      );
      log(
        "Book stats",
        `${clientDef.displayName} — ${book.transactions} txs, ${book.accounts} accts`
      );

      clientRows.push({
        email: clientDef.email,
        id: client.id,
        displayName: clientDef.displayName,
      });
    }

    const keepIds = new Set(clientRows.map((c) => c.id));
    const { data: staleGrants } = await admin
      .from("client_module_access")
      .select("id, client_user_id")
      .eq("distributor_tenant_id", tenantId)
      .eq("module_id", treasuryModule.id)
      .eq("status", "active");
    for (const g of staleGrants ?? []) {
      if (!keepIds.has(g.client_user_id)) {
        await admin
          .from("client_module_access")
          .update({ status: "revoked" })
          .eq("id", g.id);
        log("Prune grant", g.client_user_id.slice(0, 8));
      }
    }

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
      label: `mcp-gate-${op.key}`,
    });
    if (tokErr) throw new Error(tokErr.message);

    out[op.key] = {
      email: op.email,
      operatorId: operator.id,
      tenantId,
      clientIds: clientRows.map((c) => c.id),
      clients: clientRows,
      token: raw,
    };
  }

  const outPath = join(__dirname, ".mcp-gate-tokens.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  log("Wrote", outPath);

  console.log("\n=== MCP operator tokens (shown once) ===");
  for (const op of MCP_OPERATORS) {
    const row = out[op.key]!;
    console.log(`${op.displayName} (${row.email})`);
    console.log(`  clients: ${row.clients.map((c) => c.displayName).join(", ")}`);
    console.log(`  bearer:  ${row.token}`);
    console.log(
      `  connect: npx mcp-remote ${process.env.MCP_GATE_URL ?? "https://<app>/api/mcp"} --header "Authorization: Bearer ${row.token}"`
    );
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
