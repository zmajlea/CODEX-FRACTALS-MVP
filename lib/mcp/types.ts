import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type McpAdminClient = SupabaseClient<Database>;

export type McpAuthContext = {
  operatorUserId: string;
  tenantId: string;
  tokenId: string;
  scopes: string[];
  source: "dev";
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
        source?: "dev";
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
