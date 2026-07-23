/**
 * Spec 57 Part 0 — Ana gate operator + four clients on tenant ana-gate.
 * Passwords reset every run. Isolated from r1-gate and demo.
 *
 * Usage: npm run test:seed:ana-gate
 * Then:  npx tsx scripts/seed-ana-gate-book.ts
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

export const ANA_GATE_OPERATOR_EMAIL = "ana_gate_operator@codexone.test";
export const ANA_GATE_PASSWORD = "ana_gate_2026!";
export const ANA_GATE_TENANT_SLUG = "ana-gate";
export const ANA_GATE_TENANT_NAME = "Ana Gate";

export const ANA_GATE_CLIENTS = [
  { email: "ana_gate_client_1@codexone.test", displayName: "Ana Gate Client 1" },
  { email: "ana_gate_client_2@codexone.test", displayName: "Ana Gate Client 2" },
  { email: "ana_gate_client_3@codexone.test", displayName: "Ana Gate Client 3" },
  { email: "ana_gate_client_4@codexone.test", displayName: "Ana Gate Client 4" },
];

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

async function ensureAuthUser(admin, email, password, displayName) {
  log("Auth user", `lookup ${email}`);
  let user = await findAuthUserByEmail(admin, email);

  if (!user) {
    log("Auth user", "creating (email_confirm=true)");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    user = data.user;
    log("Auth user", `created ${user.id}`);
  } else {
    log("Auth user", `exists ${user.id} — resetting password`);
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

async function resolveModuleId(admin, slug) {
  const { data, error } = await admin.from("modules").select("id").eq("slug", slug).maybeSingle();
  if (error || !data) throw new Error(`Module '${slug}' not found`);
  return data.id;
}

async function ensureTenant(admin) {
  log("Tenant", `lookup slug ${ANA_GATE_TENANT_SLUG}`);
  const { data: existing } = await admin
    .from("tenants")
    .select("id, name")
    .eq("domain_slug", ANA_GATE_TENANT_SLUG)
    .maybeSingle();

  if (existing) {
    log("Tenant", `reusing ${existing.id} (${existing.name})`);
    return existing.id;
  }

  log("Tenant", "creating");
  const { data: created, error } = await admin
    .from("tenants")
    .insert({
      name: ANA_GATE_TENANT_NAME,
      domain_slug: ANA_GATE_TENANT_SLUG,
      brand_color_hex: "#EBC06D",
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

async function ensureClientGrant(admin, tenantId, clientUserId, moduleId, grantedBy, email) {
  log("Client grant", `${email} → treasury`);
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
    console.error("Missing Supabase env");
    process.exit(1);
  }

  log("Start", "Spec 57 Part 0 ana-gate environment");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const operator = await ensureAuthUser(
    admin,
    ANA_GATE_OPERATOR_EMAIL,
    ANA_GATE_PASSWORD,
    "Ana Gate Operator"
  );

  const treasuryModuleId = await resolveModuleId(admin, "treasury");
  const tenantId = await ensureTenant(admin);
  await ensureOperatorRole(admin, operator.id, tenantId);
  await ensureOperatorModule(admin, tenantId, treasuryModuleId, operator.id);

  const clientIds = [];
  for (const c of ANA_GATE_CLIENTS) {
    const user = await ensureAuthUser(admin, c.email, ANA_GATE_PASSWORD, c.displayName);
    await ensureClientGrant(
      admin,
      tenantId,
      user.id,
      treasuryModuleId,
      operator.id,
      c.email
    );
    await admin.from("treasury_client_operator_profile").upsert(
      {
        distributor_tenant_id: tenantId,
        client_user_id: user.id,
        industry: null,
        next_note: null,
        watch_note: null,
        attention_reason: null,
      },
      { onConflict: "distributor_tenant_id,client_user_id" }
    );
    clientIds.push({ email: c.email, id: user.id, displayName: c.displayName });
  }

  // Isolation: ana-gate operator must not hold grants on r1-gate or summit-test-op
  for (const foreignSlug of ["r1-gate", "summit-test-op"]) {
    const { data: foreignTenant } = await admin
      .from("tenants")
      .select("id")
      .eq("domain_slug", foreignSlug)
      .maybeSingle();
    if (!foreignTenant) continue;
    const { count: leak } = await admin
      .from("client_module_access")
      .select("id", { count: "exact", head: true })
      .eq("distributor_tenant_id", foreignTenant.id)
      .eq("granted_by", operator.id);
    if ((leak ?? 0) > 0) {
      throw new Error(
        `Isolation fail: ana-gate operator has ${leak} grants on ${foreignSlug}`
      );
    }
  }

  // Ana portfolio must only see her 4 clients (no Tim / demo grants via this tenant)
  const { data: anaGrants, error: grantsErr } = await admin
    .from("client_module_access")
    .select("client_user_id, status")
    .eq("distributor_tenant_id", tenantId)
    .eq("status", "active");
  if (grantsErr) throw new Error(grantsErr.message);
  if ((anaGrants ?? []).length !== 4) {
    throw new Error(`Expected 4 active grants on ana-gate, got ${anaGrants?.length}`);
  }
  const anaClientIds = new Set(clientIds.map((c) => c.id));
  for (const g of anaGrants ?? []) {
    if (!anaClientIds.has(g.client_user_id)) {
      throw new Error(`Isolation fail: foreign client ${g.client_user_id} on ana-gate`);
    }
  }

  // Operator role must not also be on r1-gate
  const { data: r1Tenant } = await admin
    .from("tenants")
    .select("id")
    .eq("domain_slug", "r1-gate")
    .maybeSingle();
  if (r1Tenant) {
    const { count: r1Role } = await admin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", operator.id)
      .eq("tenant_id", r1Tenant.id);
    if ((r1Role ?? 0) > 0) {
      throw new Error("Isolation fail: ana-gate operator also has role on r1-gate");
    }
  }

  await verifySignIn(url, anonKey, ANA_GATE_OPERATOR_EMAIL, ANA_GATE_PASSWORD);
  await verifySignIn(url, anonKey, ANA_GATE_CLIENTS[0].email, ANA_GATE_PASSWORD);
  await verifySignIn(url, anonKey, ANA_GATE_CLIENTS[3].email, ANA_GATE_PASSWORD);

  console.log("\n--- Spec 57 Part 0 credentials ---");
  console.log("Operator:", ANA_GATE_OPERATOR_EMAIL, "/", ANA_GATE_PASSWORD);
  console.log("Tenant:", ANA_GATE_TENANT_SLUG, `(${tenantId})`);
  for (const c of clientIds) {
    console.log(`Client: ${c.email} / ${ANA_GATE_PASSWORD}  id=${c.id}  (${c.displayName})`);
  }
  console.log("\nIsolation: ana-gate has exactly 4 clients; no r1-gate/summit leak.");
  console.log("Next: npx tsx scripts/seed-ana-gate-book.ts  (Client 1 only — leave pristine)");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
