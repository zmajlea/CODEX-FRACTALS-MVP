import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

/** Spec 67 B2 — monthly outflows via aggregate RPC (no fetch-all). */
export async function loadMonthlyOutflows(
  admin: AdminClient,
  clientUserId: string,
  opts: { accountId: string; label?: string; from: string; to: string }
): Promise<Record<string, number>> {
  const { data, error } = await admin.rpc("treasury_monthly_outflows", {
    p_client: clientUserId,
    p_account_id: opts.accountId,
    p_from: opts.from,
    p_to: opts.to,
    p_label: opts.label ?? null,
  });
  if (error) {
    console.error("[loadMonthlyOutflows]", error);
    throw new Error(error.message);
  }
  const obj = (data ?? {}) as Record<string, number>;
  const map: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    map[k.slice(0, 10)] = Number(v) || 0;
  }
  return map;
}
