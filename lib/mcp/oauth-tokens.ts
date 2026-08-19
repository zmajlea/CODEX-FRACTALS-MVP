import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import type { Database } from "@/lib/database.types";
import { oauthAccessTtlSec, parseScopeString, type McpOAuthScope } from "@/lib/mcp/oauth-config";
import { consumeAuthorizationCode } from "@/lib/mcp/oauth-codes";
import { mintAccessToken } from "@/lib/mcp/oauth-jwt";
import { verifyPkceS256 } from "@/lib/mcp/oauth-pkce";
import {
  mintRefreshToken,
  revokeRefreshTokenFamily,
  rotateRefreshToken,
} from "@/lib/mcp/oauth-refresh";

type Admin = SupabaseClient<Database>;

export async function exchangeAuthorizationCode(
  admin: Admin,
  params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }
) {
  const consumed = await consumeAuthorizationCode(admin, {
    code: params.code,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
  });
  if (!consumed.ok) {
    return { ok: false as const, error: consumed.error };
  }

  if (consumed.row.code_challenge_method !== "S256") {
    return { ok: false as const, error: "invalid_grant" };
  }
  if (!verifyPkceS256(params.codeVerifier, consumed.row.code_challenge)) {
    return { ok: false as const, error: "invalid_grant" };
  }

  const scopes = parseScopeString(consumed.row.scope);
  return issueTokenPair(admin, {
    operatorUserId: consumed.row.operator_user_id,
    tenantId: consumed.row.tenant_id,
    clientId: params.clientId,
    scopes,
    scopeString: scopes.join(" "),
  });
}

export async function exchangeRefreshToken(
  admin: Admin,
  rawRefresh: string
) {
  const rotated = await rotateRefreshToken(admin, rawRefresh);
  if (!rotated.ok) {
    if (rotated.reuse) {
      // Best-effort family revoke on reuse detection
      const tokenHash = createHash("sha256").update(rawRefresh, "utf8").digest("hex");
      const { data: row } = await admin
        .from("oauth_refresh_tokens")
        .select("operator_user_id, client_id")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (row) {
        await revokeRefreshTokenFamily(
          admin,
          row.operator_user_id,
          row.client_id
        );
      }
    }
    return { ok: false as const, error: rotated.error };
  }

  const scopes = parseScopeString(rotated.scope);
  return issueTokenPair(admin, {
    operatorUserId: rotated.operatorUserId,
    tenantId: rotated.tenantId,
    clientId: rotated.clientId,
    scopes,
    scopeString: rotated.scope,
  });
}

async function issueTokenPair(
  admin: Admin,
  params: {
    operatorUserId: string;
    tenantId: string;
    clientId: string;
    scopes: McpOAuthScope[];
    scopeString: string;
    rotatedFrom?: string;
  }
) {
  const access = await mintAccessToken({
    operatorUserId: params.operatorUserId,
    tenantId: params.tenantId,
    scopes: params.scopes,
  });
  const refresh = await mintRefreshToken(admin, {
    operatorUserId: params.operatorUserId,
    tenantId: params.tenantId,
    clientId: params.clientId,
    scope: params.scopeString,
    rotatedFrom: params.rotatedFrom,
  });

  return {
    ok: true as const,
    access_token: access.token,
    token_type: "Bearer" as const,
    expires_in: oauthAccessTtlSec(),
    refresh_token: refresh.token,
    scope: params.scopeString,
  };
}

/** Headless gate: mint tokens without HTTP authorize (same persistence as consent). */
export async function issueTokensForOperator(
  admin: Admin,
  params: {
    operatorUserId: string;
    tenantId: string;
    clientId: string;
    scope: string;
  }
) {
  const scopes = parseScopeString(params.scope);
  return issueTokenPair(admin, {
    operatorUserId: params.operatorUserId,
    tenantId: params.tenantId,
    clientId: params.clientId,
    scopes,
    scopeString: scopes.join(" "),
  });
}
