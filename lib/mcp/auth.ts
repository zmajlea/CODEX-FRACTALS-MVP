import { createHash, randomBytes } from "crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { McpAuthContext } from "@/lib/mcp/types";
import { verifyAccessToken } from "@/lib/mcp/oauth-jwt";

export function hashOperatorToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateOperatorToken(): string {
  return `mcp_${randomBytes(32).toString("base64url")}`;
}

export function devTokensEnabled(): boolean {
  return process.env.MCP_DEV_TOKENS_ENABLED === "true";
}

function toAuthInfo(bearerToken: string, ctx: McpAuthContext): AuthInfo {
  return {
    token: bearerToken,
    scopes: ctx.scopes,
    clientId: ctx.operatorUserId,
    extra: ctx,
    expiresAt:
      ctx.source === "oauth" && ctx.expiresAt ? ctx.expiresAt : undefined,
  };
}

async function verifyDevToken(
  bearerToken: string
): Promise<McpAuthContext | undefined> {
  if (!devTokensEnabled()) return undefined;

  const admin = createSupabaseAdminClient();
  const tokenHash = hashOperatorToken(bearerToken.trim());

  const { data: row, error } = await admin
    .from("operator_api_tokens")
    .select("id, operator_user_id, tenant_id, scopes, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !row || row.revoked_at) return undefined;

  void admin
    .from("operator_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);

  return {
    operatorUserId: row.operator_user_id,
    tenantId: row.tenant_id,
    tokenId: row.id,
    scopes: row.scopes ?? ["treasury:read", "treasury:write"],
    source: "dev",
  };
}

async function verifyOAuthBearer(
  bearerToken: string
): Promise<McpAuthContext | undefined> {
  try {
    const claims = await verifyAccessToken(bearerToken.trim());
    if (!claims) return undefined;
    return {
      operatorUserId: claims.operatorUserId,
      tenantId: claims.tenantId,
      tokenId: claims.jti,
      scopes: claims.scopes,
      source: "oauth",
      expiresAt: claims.expiresAt,
    };
  } catch {
    return undefined;
  }
}

/** B2: OAuth JWT first, then B1 dev bearer when enabled. */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken?.trim()) return undefined;

  const oauthCtx = await verifyOAuthBearer(bearerToken);
  if (oauthCtx) return toAuthInfo(bearerToken, oauthCtx);

  const devCtx = await verifyDevToken(bearerToken);
  if (devCtx) return toAuthInfo(bearerToken, devCtx);

  return undefined;
}
