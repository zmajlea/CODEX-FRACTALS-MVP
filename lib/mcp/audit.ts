import type { McpAdminClient } from "@/lib/mcp/types";

export async function writeMcpAudit(
  admin: McpAdminClient,
  row: {
    operatorUserId: string;
    tenantId: string;
    tool: string;
    clientId?: string | null;
    ok: boolean;
    error?: string | null;
    ip?: string | null;
  }
): Promise<void> {
  const { error } = await admin.from("mcp_audit_log").insert({
    operator_user_id: row.operatorUserId,
    tenant_id: row.tenantId,
    tool: row.tool,
    client_id: row.clientId ?? null,
    ok: row.ok,
    error: row.error ?? null,
    ip: row.ip ?? null,
  });
  if (error) {
    console.error("[mcp audit]", error.message);
  }
}
