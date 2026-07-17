/**
 * Dev test operator for portal login + treasury operator UI.
 * Mirrors journey1-test pattern: @codexone.test email, known password, auto-confirmed.
 *
 * Usage: node scripts/seed-operator-test.mjs
 *        npm run test:seed:operator
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

export const OPERATOR_TEST_EMAIL = "operator-test@codexone.test";
export const OPERATOR_TEST_PASSWORD = "OperatorTest!2026";
const CLIENT_EMAIL = "journey1-test@codexone.test";
const TENANT_SLUG = "summit-test-op";
const TENANT_NAME = "Summit Test Operator";

function log(step, detail = "") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}${detail ? ` — ${detail}` : ""}`);
}

async function findAuthUserByEmail(admin, email) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function ensureAuthUser(admin, email, password) {
  log("Auth user", `lookup ${email}`);
  let user = await findAuthUserByEmail(admin, email);

  if (!user) {
    log("Auth user", "creating (email_confirm=true)");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Summit Test Operator" },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    user = data.user;
    log("Auth user", `created ${user.id}`);
  } else {
    log("Auth user", `exists ${user.id} — resetting password`);
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUser: ${error.message}`);
  }

  const { error: profileErr } = await admin.from("users").upsert({
    id: user.id,
    email,
    display_name: "Summit Test Operator",
  });
  if (profileErr) throw new Error(`users upsert: ${profileErr.message}`);

  return user;
}

async function resolveModuleId(admin, slug) {
  const { data, error } = await admin.from("modules").select("id").eq("slug", slug).maybeSingle();
  if (error || !data) throw new Error(`Module '${slug}' not found`);
  return data.id;
}

async function ensureTenant(admin, operatorUserId) {
  log("Tenant", `lookup slug ${TENANT_SLUG}`);
  const { data: existing } = await admin
    .from("tenants")
    .select("id, name")
    .eq("domain_slug", TENANT_SLUG)
    .maybeSingle();

  if (existing) {
    log("Tenant", `reusing ${existing.id} (${existing.name})`);
    return existing.id;
  }

  log("Tenant", "creating");
  const { data: created, error } = await admin
    .from("tenants")
    .insert({
      name: TENANT_NAME,
      domain_slug: TENANT_SLUG,
      brand_color_hex: "#E67E50",
      available_credits: 100,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(`tenant insert: ${error?.message ?? "unknown"}`);
  log("Tenant", `created ${created.id}`);
  return created.id;
}

async function ensureOperatorRole(admin, userId, tenantId) {
  log("Role", "operator on tenant");
  const { data: existing } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "operator")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    log("Role", "already assigned");
    return;
  }

  const { error } = await admin.from("user_roles").insert({
    user_id: userId,
    role: "operator",
    tenant_id: tenantId,
    granted_by: userId,
  });
  if (error) throw new Error(`user_roles insert: ${error.message}`);
  log("Role", "assigned");
}

async function ensureOperatorModule(admin, tenantId, moduleId, grantedBy) {
  log("Operator module", "treasury allowed");
  const { error } = await admin.from("operator_modules").upsert(
    {
      distributor_tenant_id: tenantId,
      module_id: moduleId,
      allowed: true,
      granted_by: grantedBy,
    },
    { onConflict: "distributor_tenant_id,module_id" }
  );
  if (error) throw new Error(`operator_modules upsert: ${error.message}`);
}

async function ensureClientGrant(admin, tenantId, clientUserId, moduleId, grantedBy) {
  log("Client grant", `${CLIENT_EMAIL} → treasury`);
  const { data: existing } = await admin
    .from("client_module_access")
    .select("id, status")
    .eq("client_user_id", clientUserId)
    .eq("distributor_tenant_id", tenantId)
    .eq("module_id", moduleId)
    .maybeSingle();

  if (existing?.status === "active") {
    log("Client grant", `active ${existing.id}`);
    return existing.id;
  }

  if (existing) {
    const { error } = await admin
      .from("client_module_access")
      .update({ status: "active", granted_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`grant reactivate: ${error.message}`);
    log("Client grant", `reactivated ${existing.id}`);
    return existing.id;
  }

  const { data: created, error } = await admin
    .from("client_module_access")
    .insert({
      client_user_id: clientUserId,
      distributor_tenant_id: tenantId,
      module_id: moduleId,
      status: "active",
      granted_by: grantedBy,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(`grant insert: ${error?.message ?? "unknown"}`);
  log("Client grant", `created ${created.id}`);
  return created.id;
}

async function verifySignIn(url, anonKey, email, password) {
  log("Sign-in test", email);
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword: ${error.message}`);
  log("Sign-in test", `OK (${data.user.id})`);
  await client.auth.signOut();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !serviceKey || !anonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or publishable key");
    process.exit(1);
  }

  log("Start", "seed operator test credentials");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const operator = await ensureAuthUser(admin, OPERATOR_TEST_EMAIL, OPERATOR_TEST_PASSWORD);

  const { data: clientRow, error: clientErr } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", CLIENT_EMAIL)
    .maybeSingle();

  if (clientErr || !clientRow) {
    throw new Error(
      `Client ${CLIENT_EMAIL} not found — run npm run test:seed first`
    );
  }
  log("Client", `${clientRow.email} (${clientRow.id})`);

  const treasuryModuleId = await resolveModuleId(admin, "treasury");
  const tenantId = await ensureTenant(admin, operator.id);
  await ensureOperatorRole(admin, operator.id, tenantId);
  await ensureOperatorModule(admin, tenantId, treasuryModuleId, operator.id);
  await ensureClientGrant(admin, tenantId, clientRow.id, treasuryModuleId, operator.id);

  await verifySignIn(url, anonKey, OPERATOR_TEST_EMAIL, OPERATOR_TEST_PASSWORD);

  console.log("\n--- Operator test credentials ready ---");
  console.log("Portal login:", OPERATOR_TEST_EMAIL, "/", OPERATOR_TEST_PASSWORD);
  console.log("Client record:", `http://localhost:14000/operator/treasury/clients/${clientRow.id}`);
  console.log("Tenant:", TENANT_SLUG, `(${tenantId})`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
