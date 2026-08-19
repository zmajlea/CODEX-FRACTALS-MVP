import { operatorHasClientGrant } from "@/lib/auth/rbac";
import type { McpAdminClient, McpAuthContext } from "@/lib/mcp/types";

export async function requireMcpClientGrant(
  admin: McpAdminClient,
  auth: McpAuthContext,
  clientId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const grant = await operatorHasClientGrant(
    admin,
    auth.operatorUserId,
    clientId,
    "treasury",
    { allowGlobalAdmin: true }
  );
  if (!grant || grant.tenantId !== auth.tenantId) {
    return {
      ok: false,
      message: `No treasury grant for client ${clientId}.`,
    };
  }
  return { ok: true };
}
