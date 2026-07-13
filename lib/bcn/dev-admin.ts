import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export async function claimBootstrapGlobalAdmin(
  supabase: SupabaseClient<Database>
): Promise<boolean> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("claim_bootstrap_global_admin is disabled in production");
  }

  const { data, error } = await supabase.rpc("claim_bootstrap_global_admin");
  if (error) throw new Error(error.message);
  return Boolean(data);
}
