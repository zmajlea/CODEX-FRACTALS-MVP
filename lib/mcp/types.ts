import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { McpOAuthScope } from "@/lib/mcp/oauth-config";

export type McpAdminClient = SupabaseClient<Database>;

export type McpAuthContext = {
  operatorUserId: string;
  tenantId: string;
  tokenId: string;
  scopes: string[];
  source: "dev" | "oauth";
  expiresAt?: number;
};

export type McpToolContext = {
  auth: McpAuthContext;
  admin: McpAdminClient;
  request: Request;
  ip: string | null;
};

export function authContextFromInfo(
  info: AuthInfo | undefined
): McpAuthContext | null {
  const extra = info?.extra as
    | {
        operatorUserId?: string;
        tenantId?: string;
        tokenId?: string;
        scopes?: string[];
        source?: "dev" | "oauth";
        expiresAt?: number;
      }
    | undefined;
  if (
    !extra?.operatorUserId ||
    !extra?.tenantId ||
    !extra?.tokenId ||
    !extra?.scopes
  ) {
    return null;
  }
  return {
    operatorUserId: extra.operatorUserId,
    tenantId: extra.tenantId,
    tokenId: extra.tokenId,
    scopes: extra.scopes,
    source: extra.source ?? "dev",
    expiresAt: extra.expiresAt,
  };
}

export function mcpText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function requireMcpScope(
  auth: McpAuthContext,
  scope: McpOAuthScope
): ReturnType<typeof mcpError> | null {
  if (!auth.scopes.includes(scope)) {
    return mcpError(`Insufficient scope: ${scope} required.`);
  }
  return null;
}
