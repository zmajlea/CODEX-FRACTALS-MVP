import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** Ensure public.users row exists (auth trigger may have missed pre-migration signups). */
export async function ensureUserProfile(
  supabase: SupabaseClient<Database>
): Promise<void> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Not signed in");
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  const { error: upsertError } = await supabase.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      display_name: displayName,
    },
    { onConflict: "id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message);
  }
}
