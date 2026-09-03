import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

export type MetricReferenceHit = {
  draft_blocks: number;
  published_versions: number;
};

/** Spec B15 — find draft blocks + published snapshots that cite a metric. */
export async function findMetricReferences(
  admin: Admin,
  tenantId: string,
  clientId: string,
  metricId: string
): Promise<MetricReferenceHit> {
  const { data: drafts } = await admin
    .from("treasury_reviews")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft");
  const draftIds = (drafts ?? []).map((r) => r.id);

  let draft_blocks = 0;
  if (draftIds.length) {
    const { count } = await admin
      .from("treasury_review_blocks")
      .select("id", { count: "exact", head: true })
      .eq("metric_id", metricId)
      .in("review_id", draftIds);
    draft_blocks = count ?? 0;
  }

  const { data: published } = await admin
    .from("treasury_reviews")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "published");
  const publishedIds = (published ?? []).map((r) => r.id);

  let published_versions = 0;
  if (publishedIds.length) {
    const { data: versions } = await admin
      .from("treasury_review_versions")
      .select("id, snapshot")
      .in("review_id", publishedIds)
      .is("superseded_at", null);
    for (const ver of versions ?? []) {
      const snap = ver.snapshot as {
        blocks?: Array<{ metric_id?: string }>;
      } | null;
      if (snap?.blocks?.some((b) => b.metric_id === metricId)) {
        published_versions += 1;
      }
    }
  }

  return { draft_blocks, published_versions };
}
