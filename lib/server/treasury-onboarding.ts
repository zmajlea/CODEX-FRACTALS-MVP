import "server-only";

import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function findAuthUserByEmail(admin: Admin, email: string) {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find(
      (u) => u.email?.toLowerCase() === normalized
    );
    if (hit) return hit;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

export async function resolveTreasuryModuleId(admin: Admin): Promise<string> {
  const { data, error } = await admin
    .from("modules")
    .select("id")
    .eq("slug", "treasury")
    .maybeSingle();
  if (error || !data) throw new Error("treasury module missing");
  return data.id;
}

export type CreateTreasuryClientInput = {
  tenantId: string;
  operatorUserId: string;
  email: string;
  name: string;
  firmLabel?: string;
};

export type CreateTreasuryClientResult = {
  clientId: string;
  grantId: string;
  created: boolean;
  inviteToken: string;
  inviteId: string;
};

/**
 * Spec B10 Part A — create (or look up) Auth user + client role + treasury grant + profile.
 * Returns a fresh invite token for activation email.
 */
export async function createTreasuryClient(
  admin: Admin,
  input: CreateTreasuryClientInput
): Promise<CreateTreasuryClientResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email || !name) throw new Error("name and email required");

  const moduleId = await resolveTreasuryModuleId(admin);

  // Idempotent: existing grant on this tenant
  const existingUser = await findAuthUserByEmail(admin, email);
  if (existingUser) {
    const { data: otherGrant } = await admin
      .from("client_module_access")
      .select("id, distributor_tenant_id, status")
      .eq("client_user_id", existingUser.id)
      .eq("module_id", moduleId)
      .neq("distributor_tenant_id", input.tenantId)
      .maybeSingle();
    if (otherGrant) {
      throw new Error("Client email already belongs to another firm");
    }

    const { data: existingGrant } = await admin
      .from("client_module_access")
      .select("id, status")
      .eq("client_user_id", existingUser.id)
      .eq("module_id", moduleId)
      .eq("distributor_tenant_id", input.tenantId)
      .maybeSingle();

    if (existingGrant) {
      const invite = await mintDistributorInvite(admin, {
        tenantId: input.tenantId,
        clientUserId: existingUser.id,
        email,
        createdBy: input.operatorUserId,
      });
      return {
        clientId: existingUser.id,
        grantId: existingGrant.id,
        created: false,
        inviteToken: invite.token,
        inviteId: invite.id,
      };
    }
  }

  let clientId: string;
  if (existingUser) {
    clientId = existingUser.id;
    await admin.auth.admin.updateUserById(clientId, {
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        full_name: name,
        firm: input.firmLabel?.trim() || undefined,
      },
    });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        firm: input.firmLabel?.trim() || undefined,
      },
    });
    if (error || !data.user) {
      throw new Error(error?.message ?? "Failed to create auth user");
    }
    clientId = data.user.id;
  }

  await admin.from("users").upsert(
    {
      id: clientId,
      email,
      display_name: name,
    },
    { onConflict: "id" }
  );

  const { data: existingRole } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", clientId)
    .eq("role", "client")
    .maybeSingle();
  if (!existingRole) {
    const { error: roleErr } = await admin.from("user_roles").insert({
      user_id: clientId,
      role: "client",
      tenant_id: null,
      granted_by: input.operatorUserId,
    });
    if (roleErr) throw new Error(`user_roles: ${roleErr.message}`);
  }

  const { data: grant, error: grantErr } = await admin
    .from("client_module_access")
    .insert({
      client_user_id: clientId,
      distributor_tenant_id: input.tenantId,
      module_id: moduleId,
      status: "active",
      granted_by: input.operatorUserId,
    })
    .select("id")
    .single();
  if (grantErr || !grant) {
    throw new Error(grantErr?.message ?? "Failed to create grant");
  }

  await admin.from("treasury_client_operator_profile").upsert(
    {
      distributor_tenant_id: input.tenantId,
      client_user_id: clientId,
      industry: input.firmLabel?.trim() || null,
      next_note: null,
      watch_note: null,
      attention_reason: null,
    },
    { onConflict: "distributor_tenant_id,client_user_id" }
  );

  const invite = await mintDistributorInvite(admin, {
    tenantId: input.tenantId,
    clientUserId: clientId,
    email,
    createdBy: input.operatorUserId,
  });

  return {
    clientId,
    grantId: grant.id,
    created: true,
    inviteToken: invite.token,
    inviteId: invite.id,
  };
}

export async function mintDistributorInvite(
  admin: Admin,
  input: {
    tenantId: string;
    clientUserId: string;
    email: string;
    createdBy: string;
  }
): Promise<{ id: string; token: string }> {
  // Revoke prior pending invites for this client+tenant
  await admin
    .from("distributor_client_invites")
    .update({ status: "revoked" })
    .eq("tenant_id", input.tenantId)
    .eq("client_user_id", input.clientUserId)
    .eq("status", "pending");

  const token = generateInviteToken();
  const { data, error } = await admin
    .from("distributor_client_invites")
    .insert({
      tenant_id: input.tenantId,
      client_user_id: input.clientUserId,
      email: input.email.trim().toLowerCase(),
      token_hash: hashInviteToken(token),
      status: "pending",
      expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create invite");
  }
  return { id: data.id, token };
}

export type InviteLookup =
  | { ok: true; invite: Database["public"]["Tables"]["distributor_client_invites"]["Row"] }
  | { ok: false; error: "invalid" | "expired" | "consumed" | "revoked" };

export async function lookupInviteByToken(
  admin: Admin,
  rawToken: string
): Promise<InviteLookup> {
  const hash = hashInviteToken(rawToken);
  const { data } = await admin
    .from("distributor_client_invites")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!data) return { ok: false, error: "invalid" };
  if (data.status === "consumed") return { ok: false, error: "consumed" };
  if (data.status === "revoked") return { ok: false, error: "revoked" };
  if (data.status !== "pending") return { ok: false, error: "invalid" };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await admin
      .from("distributor_client_invites")
      .update({ status: "expired" })
      .eq("id", data.id);
    return { ok: false, error: "expired" };
  }
  return { ok: true, invite: data };
}

export async function consumeInvite(
  admin: Admin,
  inviteId: string
): Promise<void> {
  await admin
    .from("distributor_client_invites")
    .update({
      status: "consumed",
      consumed_at: new Date().toISOString(),
    })
    .eq("id", inviteId)
    .eq("status", "pending");
}
