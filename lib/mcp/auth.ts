import { createHash, randomBytes } from "crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { McpAuthContext } from "@/lib/mcp/types";

export function hashOperatorToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateOperatorToken(): string {
  return `mcp_${randomBytes(32).toString("base64url")}`;
}

export function devTokensEnabled(): boolean {
  return process.env.MCP_DEV_TOKENS_ENABLED === "true";
}

/** B1: dev bearer only. B2 extends this for OAuth JWTs. */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!devTokensEnabled()) return undefined;
  if (!bearerToken?.trim()) return undefined;

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

  const ctx: McpAuthContext = {
    operatorUserId: row.operator_user_id,
    tenantId: row.tenant_id,
    tokenId: row.id,
    scopes: row.scopes ?? ["treasury:read", "treasury:write"],
    source: "dev",
  };

  return {
    token: bearerToken,
    scopes: ctx.scopes,
    clientId: ctx.operatorUserId,
    extra: ctx,
  };
}
