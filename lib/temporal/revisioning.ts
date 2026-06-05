import type { SupabaseClient } from "@supabase/supabase-js";

export type PulseVersion = {
  version: number;
  sealedAt: string | null;
  isCanonical: boolean;
};

export async function fetchPulseVersions(
  supabase: SupabaseClient,
  objectId: string
): Promise<PulseVersion[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("temporal_object_versions")
    .select("version_number, sealed_at, is_canonical")
    .eq("object_id", objectId)
    .order("version_number", { ascending: false });
  return (data ?? []).map(
    (r: {
      version_number: number;
      sealed_at: string | null;
      is_canonical: boolean;
    }) => ({
      version: r.version_number,
      sealedAt: r.sealed_at,
      isCanonical: r.is_canonical,
    })
  );
}
