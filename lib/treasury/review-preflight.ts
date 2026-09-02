import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { scanEnvelopeFields } from "@/lib/treasury/envelope-scan";
import {
  isBlockStale,
  normalizeBlockRow,
  normalizeReviewRow,
  type ReviewBlockRow,
} from "@/lib/treasury/review-assemble";
import { normalizeRecommendationRow } from "@/lib/server/treasury-recommendation-evidence";

type Admin = SupabaseClient<Database>;

export type ReviewPreflight = {
  proposed_count: number;
  stale_count: number;
  envelope_violations: Array<{
    field: string;
    code: string;
    message: string;
    match?: string;
  }>;
  stale_block_ids: string[];
  proposed_block_ids: string[];
};

export async function computeReviewPreflight(
  admin: Admin,
  reviewId: string
): Promise<ReviewPreflight> {
  const { data: reviewRow, error: revErr } = await admin
    .from("treasury_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();

  if (revErr || !reviewRow) {
    throw new Error("Review not found");
  }

  const review = normalizeReviewRow(reviewRow as Record<string, unknown>);

  const { data: blockRows, error: blkErr } = await admin
    .from("treasury_review_blocks")
    .select("*")
    .eq("review_id", reviewId)
    .order("position", { ascending: true });

  if (blkErr) throw new Error(blkErr.message);

  const blocks = (blockRows ?? []).map((r) =>
    normalizeBlockRow(r as Record<string, unknown>)
  );

  const proposed_block_ids = blocks
    .filter((b) => b.proposal_state === "proposed")
    .map((b) => b.id);

  const stale_block_ids: string[] = [];
  for (const block of blocks) {
    if (await isBlockStale(admin, review.tenant_id, review.client_user_id, block)) {
      stale_block_ids.push(block.id);
    }
  }

  const scanFields: Array<{ id: string; text: string }> = [];

  for (const block of blocks) {
    if (block.caption.trim()) {
      scanFields.push({ id: `block:${block.id}:caption`, text: block.caption });
    }
    if (block.role === "note" && block.body.trim()) {
      scanFields.push({ id: `block:${block.id}:body`, text: block.body });
    }
    if (block.role === "narrative" && block.recommendation_id) {
      const { data: rec } = await admin
        .from("treasury_recommendations")
        .select("title, why")
        .eq("id", block.recommendation_id)
        .maybeSingle();
      if (rec) {
        const row = normalizeRecommendationRow(rec as Record<string, unknown>);
        scanFields.push({ id: `block:${block.id}:title`, text: row.title });
        scanFields.push({ id: `block:${block.id}:why`, text: row.why });
      }
    }
  }

  const envelope_violations = scanEnvelopeFields(scanFields);

  return {
    proposed_count: proposed_block_ids.length,
    stale_count: stale_block_ids.length,
    envelope_violations,
    stale_block_ids,
    proposed_block_ids,
  };
}

export function preflightBlocked(p: ReviewPreflight): boolean {
  return (
    p.proposed_count > 0 ||
    p.stale_count > 0 ||
    p.envelope_violations.length > 0
  );
}
