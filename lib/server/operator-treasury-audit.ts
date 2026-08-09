import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export async function writeOperatorTreasuryReadAudit(
  admin: AdminClient,
  input: {
    actorUserId: string;
    clientUserId: string;
    tenantId: string;
    grantId?: string | null;
    surface?: "accounts" | "summary" | "transactions" | "labels" | "forecast" | "spend_plan" | "recommendations" | "inbox" | "analytics";
  }
): Promise<void> {
  await writeTreasuryAudit(admin, {
    actorUserId: input.actorUserId,
    eventType: "operator_treasury_read",
    payload: {
      client_user_id: input.clientUserId,
      tenant_id: input.tenantId,
      grant_id: input.grantId ?? null,
      module: "treasury",
      ...(input.surface ? { surface: input.surface } : {}),
    },
  });
}

export async function writeTreasuryAudit(
  admin: AdminClient,
  input: {
    actorUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  // Spec 67 C — fire-and-forget; never block the response on audit I/O
  void admin
    .from("user_audit_events")
    .insert({
      user_id: input.actorUserId,
      event_type: input.eventType,
      payload: input.payload as Json,
    })
    .then(({ error }) => {
      if (error) {
        console.error(`[treasury-audit] ${input.eventType}`, error);
      }
    });
}
