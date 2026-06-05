import type { SupabaseClient } from "@supabase/supabase-js";

/** Tables added in 20260605120000_release1_schema — extend generated types until regen. */
export async function insertRecordActivityEvent(
  supabase: SupabaseClient,
  row: {
    vault_id: string;
    record_id?: string | null;
    event_type: string;
    actor_id?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("record_activity_events").insert(row);
}

export async function insertVaultInvite(
  supabase: SupabaseClient,
  row: {
    vault_id: string;
    email: string;
    role: string;
    invited_by?: string | null;
  }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("vault_invites").insert(row);
}
