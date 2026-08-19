import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { oauthAuthCodeTtlSec } from "@/lib/mcp/oauth-config";

type Admin = SupabaseClient<Database>;

function hashCode(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type MintAuthCodeInput = {
  clientId: string;
  operatorUserId: string;
  tenantId: string;
  scope: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
};

/** Used by /oauth/consent and gate-mcp-b2 (headless). */
export async function mintAuthorizationCode(
  admin: Admin,
  input: MintAuthCodeInput
): Promise<{ code: string; expiresAt: string }> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + oauthAuthCodeTtlSec() * 1000
  ).toISOString();

  const { error } = await admin.from("oauth_auth_codes").insert({
    code_hash: hashCode(raw),
    client_id: input.clientId,
    operator_user_id: input.operatorUserId,
    tenant_id: input.tenantId,
    scope: input.scope,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod ?? "S256",
    expires_at: expiresAt,
  });

  if (error) throw new Error(error.message);
  return { code: raw, expiresAt };
}

export async function consumeAuthorizationCode(
  admin: Admin,
  params: {
    code: string;
    clientId: string;
    redirectUri: string;
  }
) {
  const codeHash = hashCode(params.code);
  const { data: row, error } = await admin
    .from("oauth_auth_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (error || !row) return { ok: false as const, error: "invalid_grant" };
  if (row.used_at) return { ok: false as const, error: "invalid_grant" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false as const, error: "invalid_grant" };
  }
  if (row.client_id !== params.clientId) {
    return { ok: false as const, error: "invalid_grant" };
  }
  if (row.redirect_uri !== params.redirectUri) {
    return { ok: false as const, error: "invalid_grant" };
  }

  const { error: markErr } = await admin
    .from("oauth_auth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null);

  if (markErr) return { ok: false as const, error: "invalid_grant" };

  return { ok: true as const, row };
}
