import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  computeBlockMetric,
  normalizeBlockRow,
  normalizeReviewRow,
  toPlacedSnapshot,
} from "@/lib/treasury/review-assemble";
import { scanEnvelope } from "@/lib/treasury/envelope-scan";
import type { Database, Json } from "@/lib/database.types";

type RouteContext = {
  params: Promise<{ clientId: string; reviewId: string; blockId: string }>;
};

/** Spec B12 — patch block (caption/recalc/confirm) or remove. */
export async function PATCH(request: Request, context: RouteContext) {
  const { clientId, reviewId, blockId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data: reviewRow } = await guard.admin
    .from("treasury_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .eq("status", "draft")
    .maybeSingle();

  if (!reviewRow) {
    return NextResponse.json({ error: "Draft review not found" }, { status: 404 });
  }

  const review = normalizeReviewRow(reviewRow as Record<string, unknown>);

  let body: {
    action?: string;
    caption?: string;
    body?: string;
    window?: unknown;
    view_mode?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: blockRow } = await guard.admin
    .from("treasury_review_blocks")
    .select("*")
    .eq("id", blockId)
    .eq("review_id", reviewId)
    .maybeSingle();

  if (!blockRow) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }

  const block = normalizeBlockRow(blockRow as Record<string, unknown>);
  const action = body.action?.trim() ?? "update";
  const update: Database["public"]["Tables"]["treasury_review_blocks"]["Update"] = {};

  if (action === "confirm_proposal") {
    update.proposal_state = "confirmed";
    update.provenance = {
      ...(typeof block.provenance === "object" ? block.provenance : {}),
      confirmed_by: guard.user.id,
      confirmed_at: new Date().toISOString(),
    } as Json;
  } else if (action === "recalculate") {
    const out = await computeBlockMetric(
      guard.admin,
      review.tenant_id,
      review.client_user_id,
      block
    );
    if (out) {
      update.placed_snapshot = toPlacedSnapshot(out);
      update.proposal_state = "none";
    }
  } else if (action === "set_window") {
    const { isPinnedWindow } = await import("@/lib/treasury/pinned-window");
    if (body.window != null && !isPinnedWindow(body.window)) {
      return NextResponse.json({ error: "Invalid window" }, { status: 400 });
    }
    const pinned = body.window == null ? null : body.window;
    update.pinned_window = pinned as Json | null;
    const nextBlock = { ...block, pinned_window: pinned as Json | null };
    const out = await computeBlockMetric(
      guard.admin,
      review.tenant_id,
      review.client_user_id,
      nextBlock
    );
    if (out) {
      update.placed_snapshot = toPlacedSnapshot(out);
      update.proposal_state = "none";
    }
  } else if (action === "set_view_mode") {
    const mode = body.view_mode === "table" ? "table" : "chart";
    update.view_mode = mode;
  } else {
    if (body.caption !== undefined) {
      const cap = body.caption.trim();
      if (scanEnvelope(cap).length) {
        return NextResponse.json({ error: "Envelope violation in caption" }, { status: 422 });
      }
      update.caption = cap;
    }
    if (body.body !== undefined) {
      const b = body.body.trim();
      if (scanEnvelope(b).length) {
        return NextResponse.json({ error: "Envelope violation in body" }, { status: 422 });
      }
      update.body = b;
    }
    if (block.proposal_state === "proposed" && (body.caption !== undefined || body.body !== undefined)) {
      update.proposal_state = "confirmed";
    }
  }

  const { data: updated, error } = await guard.admin
    .from("treasury_review_blocks")
    .update(update)
    .eq("id", blockId)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ block: normalizeBlockRow(updated as Record<string, unknown>) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { clientId, reviewId, blockId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { error } = await guard.admin
    .from("treasury_review_blocks")
    .delete()
    .eq("id", blockId)
    .eq("review_id", reviewId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
