import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  buildReviewSnapshot,
  diffSnapshotChangeNote,
  isStudyDateWindow,
  normalizeBlockRow,
  normalizeReviewRow,
  parseStudyDateWindow,
  type ReviewSnapshot,
  type StudyDateWindow,
} from "@/lib/treasury/review-assemble";
import {
  computeReviewPreflight,
  preflightBlocked,
} from "@/lib/treasury/review-preflight";
import { sendRecommendationAtPublish } from "@/lib/treasury/send-recommendation-at-publish";
import type { Json } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string; reviewId: string }> };

type PublishBody = {
  change_note?: string;
  /** Spec B19 — Edition name. */
  label?: string;
  /**
   * Spec B19 — Edition frozen from–to (metadata in Phase A).
   * Window cascade / recompute over this window is Phase B.
   */
  window?: StudyDateWindow;
};

/** Spec B12 / B19 — publish draft Study → immutable Edition (THE human gate). */
export async function POST(request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let changeNote = "";
  let editionLabel: string | null = null;
  let editionWindow: StudyDateWindow | null = null;
  try {
    const body = (await request.json()) as PublishBody;
    changeNote = body.change_note?.trim() ?? "";
    const labelRaw = body.label?.trim() ?? "";
    if (labelRaw) editionLabel = labelRaw;
    if (body.window !== undefined) {
      if (!isStudyDateWindow(body.window)) {
        return NextResponse.json(
          { error: "Invalid window: require {from,to} YYYY-MM-DD with to >= from" },
          { status: 400 }
        );
      }
      editionWindow = parseStudyDateWindow(body.window);
    }
  } catch {
    /* optional body — back-compat with change_note-only / empty */
  }

  const { data: reviewRow, error: revErr } = await guard.admin
    .from("treasury_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft")
    .maybeSingle();

  if (revErr || !reviewRow) {
    return NextResponse.json({ error: "Draft review not found" }, { status: 404 });
  }

  const review = normalizeReviewRow(reviewRow as Record<string, unknown>);
  const preflight = await computeReviewPreflight(guard.admin, reviewId);

  if (preflightBlocked(preflight)) {
    return NextResponse.json(
      { error: "Publish blocked", preflight },
      { status: 422 }
    );
  }

  const { data: blockRows } = await guard.admin
    .from("treasury_review_blocks")
    .select("*")
    .eq("review_id", reviewId)
    .order("position", { ascending: true });

  const blocks = (blockRows ?? []).map((r) =>
    normalizeBlockRow(r as Record<string, unknown>)
  );

  const newVersion = review.current_version + 1;
  const reviewedAsOf = new Date().toISOString().slice(0, 10);

  // Phase A: store edition window as metadata only — do not recompute blocks over it.
  // Prefer explicit body window, else Study live window (still metadata until Phase B).
  if (!editionWindow && review.window) {
    editionWindow = review.window;
  }
  if (!editionLabel) {
    editionLabel =
      review.title.trim() ||
      review.label.trim() ||
      review.period_month.slice(0, 7) ||
      `Edition ${newVersion}`;
  }

  let priorSnapshot: ReviewSnapshot | null = null;
  if (review.current_version > 0) {
    const { data: prior } = await guard.admin
      .from("treasury_review_versions")
      .select("snapshot")
      .eq("review_id", reviewId)
      .eq("version", review.current_version)
      .maybeSingle();
    if (prior?.snapshot) {
      priorSnapshot = prior.snapshot as unknown as ReviewSnapshot;
    }
  }

  const snapshot = await buildReviewSnapshot(
    guard.admin,
    review,
    blocks,
    newVersion,
    changeNote ||
      diffSnapshotChangeNote(priorSnapshot, {
        meta: {
          title: review.title,
          period_month: review.period_month,
          reviewed_as_of: reviewedAsOf,
          version: newVersion,
          change_note: "",
        },
        cover_figures: [],
        live_strip: { enabled: false },
        blocks: [],
        disclosures: {
          advisory: "",
          accuracy: "",
          review: "",
        },
      }),
    reviewedAsOf
  );

  if (!changeNote) {
    snapshot.meta.change_note = diffSnapshotChangeNote(priorSnapshot, snapshot);
  } else {
    snapshot.meta.change_note = changeNote;
  }

  for (const block of blocks) {
    if (block.role === "narrative" && block.recommendation_id) {
      const sent = await sendRecommendationAtPublish(
        guard.admin,
        clientId,
        block.recommendation_id,
        guard.user.id
      );
      if (!sent.ok) {
        return NextResponse.json({ error: sent.error }, { status: 422 });
      }
    }
  }

  if (review.current_version > 0) {
    await guard.admin
      .from("treasury_review_versions")
      .update({ superseded_at: new Date().toISOString() })
      .eq("review_id", reviewId)
      .eq("version", review.current_version)
      .is("superseded_at", null);
  }

  const { data: versionRow, error: verErr } = await guard.admin
    .from("treasury_review_versions")
    .insert({
      review_id: reviewId,
      version: newVersion,
      reviewed_as_of: reviewedAsOf,
      published_by: guard.user.id,
      change_note: snapshot.meta.change_note,
      snapshot: snapshot as unknown as Json,
      label: editionLabel,
      window: (editionWindow as unknown as Json) ?? null,
    })
    .select("*")
    .single();

  if (verErr || !versionRow) {
    return NextResponse.json({ error: verErr?.message ?? "Version insert failed" }, { status: 500 });
  }

  await guard.admin
    .from("treasury_reviews")
    .update({
      status: "published",
      current_version: newVersion,
      title: snapshot.meta.title,
    })
    .eq("id", reviewId);

  return NextResponse.json({
    ok: true,
    version: newVersion,
    version_id: versionRow.id,
    /** Spec B19 — Edition fields (window is metadata-only until Phase B). */
    edition: {
      label: versionRow.label ?? editionLabel,
      window: versionRow.window ?? editionWindow,
    },
    snapshot,
  });
}
