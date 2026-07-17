/**
 * Fresh bench client for import A/B timing (Spec 29).
 * No CSV data — insert-path benchmarking only.
 *
 * Usage: npm run test:seed:bench-import
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvLocal } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvLocal(resolve(__dirname, "../.env.local"));

export const BENCH_CLIENT_EMAIL = "bench-import@codexone.test";
export const BENCH_CLIENT_PASSWORD = "BenchImport!2026";
const OPERATOR_EMAIL = "operator-test@codexone.test";
const TENANT_SLUG = "summit-test-op";

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
    log("Auth user", `exists ${user.id}`);
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

async function resolveTenantId(admin) {
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("domain_slug", TENANT_SLUG)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Tenant '${TENANT_SLUG}' not found — run npm run test:seed:operator first`
    );
  }
  return data.id;
}

async function ensureClientGrant(admin, tenantId, clientUserId, moduleId, grantedBy) {
  log("Client grant", `${BENCH_CLIENT_EMAIL} → treasury`);
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  log("Start", "seed bench-import client");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const bench = await ensureAuthUser(
    admin,
    BENCH_CLIENT_EMAIL,
    BENCH_CLIENT_PASSWORD,
    "Bench Import Client"
  );

  const { data: operatorRow, error: opErr } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", OPERATOR_EMAIL)
    .maybeSingle();

  if (opErr || !operatorRow) {
    throw new Error(`${OPERATOR_EMAIL} not found — run npm run test:seed:operator first`);
  }

  const treasuryModuleId = await resolveModuleId(admin, "treasury");
  const tenantId = await resolveTenantId(admin);
  await ensureClientGrant(admin, tenantId, bench.id, treasuryModuleId, operatorRow.id);

  console.log("\n--- Bench import client ready ---");
  console.log("Client:", BENCH_CLIENT_EMAIL, `(${bench.id})`);
  console.log("Operator:", OPERATOR_EMAIL);
  console.log(
    "Record URL:",
    `http://localhost:14000/operator/treasury/clients/${bench.id}`
  );
  console.log("Wipe before each timing run: npm run test:wipe:bench-import");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
