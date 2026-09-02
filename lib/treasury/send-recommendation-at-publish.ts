import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  evidenceAsJson,
  normalizeRecommendationRow,
  parseEvidence,
  snapshotEvidenceAtSeal,
} from "@/lib/server/treasury-recommendation-evidence";
import { isRecommendationCategory } from "@/lib/treasury/recommendation-status";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";

type Admin = SupabaseClient<Database>;

type RecRow = ReturnType<typeof normalizeRecommendationRow>;

/** Spec B12 — real send path at publish (sent_at + evidence seal + sealed_at for recs). */
export async function sendRecommendationAtPublish(
  admin: Admin,
  clientUserId: string,
  recId: string,
  operatorId: string
): Promise<{ ok: true; row: RecRow } | { ok: false; error: string }> {
  const { data: rec, error: loadErr } = await admin
    .from("treasury_recommendations")
    .select("*")
    .eq("id", recId)
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (loadErr || !rec) return { ok: false, error: "Recommendation not found" };

  const current = normalizeRecommendationRow(rec as Record<string, unknown>);
  if (current.status !== "draft") {
    return { ok: true, row: current };
  }

  const isQuestion = current.kind === "question";
  const title = current.title.trim();
  const why = current.why.trim();

  if (!title) return { ok: false, error: "Title required" };
  if (!why) return { ok: false, error: isQuestion ? "Question required" : "Why required" };
  if (!isQuestion && !isRecommendationCategory(current.category)) {
    return { ok: false, error: "Category required before publish" };
  }

  const now = new Date().toISOString();
  const snapped = await snapshotEvidenceAtSeal(
    admin,
    clientUserId,
    parseEvidence(current.evidence)
  );

  const update: Database["public"]["Tables"]["treasury_recommendations"]["Update"] = {
    status: "sent",
    title,
    why,
    evidence: evidenceAsJson(snapped),
    sent_at: now,
  };

  if (!isQuestion) {
    update.sealed_at = now;
    update.sealed_by = operatorId;
  }

  const { data: updated, error } = await admin
    .from("treasury_recommendations")
    .update(update)
    .eq("id", recId)
    .eq("status", "draft")
    .select("*")
    .single();

  if (error || !updated) {
    return { ok: false, error: error?.message ?? "Send failed" };
  }

  const row = normalizeRecommendationRow(updated as Record<string, unknown>);
  await writeTreasuryAudit(admin, {
    actorUserId: operatorId,
    eventType:
      row.kind === "question"
        ? "treasury_question_sent"
        : "treasury_recommendation_sealed",
    payload: {
      client_user_id: clientUserId,
      recommendation_id: recId,
      kind: row.kind,
      sealed_at: row.sealed_at,
      sent_at: now,
      via: "review_publish",
    },
  });

  return { ok: true, row };
}
