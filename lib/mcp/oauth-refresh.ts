import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { oauthRefreshTtlSec } from "@/lib/mcp/oauth-config";

type Admin = SupabaseClient<Database>;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function mintRefreshToken(
  admin: Admin,
  params: {
    operatorUserId: string;
    tenantId: string;
    clientId: string;
    scope: string;
    rotatedFrom?: string;
  }
): Promise<{ token: string; expiresAt: string }> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + oauthRefreshTtlSec() * 1000
  ).toISOString();

  const { error } = await admin.from("oauth_refresh_tokens").insert({
    token_hash: hashToken(raw),
    operator_user_id: params.operatorUserId,
    tenant_id: params.tenantId,
    client_id: params.clientId,
    scope: params.scope,
    expires_at: expiresAt,
    rotated_from: params.rotatedFrom ?? null,
  });

  if (error) throw new Error(error.message);
  return { token: raw, expiresAt };
}

export async function rotateRefreshToken(
  admin: Admin,
  rawToken: string
): Promise<
  | {
      ok: true;
      operatorUserId: string;
      tenantId: string;
      clientId: string;
      scope: string;
    }
  | { ok: false; error: string; reuse?: boolean }
> {
  const tokenHash = hashToken(rawToken);
  const { data: row, error } = await admin
    .from("oauth_refresh_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !row) return { ok: false, error: "invalid_grant" };
  if (row.revoked_at) return { ok: false, error: "invalid_grant", reuse: true };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant" };
  }

  await admin
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", row.id);

  return {
    ok: true,
    operatorUserId: row.operator_user_id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    scope: row.scope,
  };
}

export async function revokeRefreshTokenFamily(
  admin: Admin,
  operatorUserId: string,
  clientId: string
): Promise<void> {
  await admin
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("operator_user_id", operatorUserId)
    .eq("client_id", clientId)
    .is("revoked_at", null);
}
