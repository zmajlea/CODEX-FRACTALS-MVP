import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export async function writeOperatorTreasuryReadAudit(
  admin: AdminClient,
  input: {
    actorUserId: string;
    clientUserId: string;
    tenantId: string;
    grantId?: string | null;
  }
): Promise<void> {
  const { error } = await admin.from("user_audit_events").insert({
    user_id: input.actorUserId,
    event_type: "operator_treasury_read",
    payload: {
      client_user_id: input.clientUserId,
      tenant_id: input.tenantId,
      grant_id: input.grantId ?? null,
      module: "treasury",
    },
  });

  if (error) {
    console.error("[operator-treasury-audit] insert failed", error);
  }
}
