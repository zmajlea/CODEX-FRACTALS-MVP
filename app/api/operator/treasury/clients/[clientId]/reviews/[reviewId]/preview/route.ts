import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  buildReviewSnapshot,
  isStudyDateWindow,
  normalizeBlockRow,
  normalizeReviewRow,
  parseStudyDateWindow,
  resolveEffectiveStudyWindow,
  type StudyDateWindow,
} from "@/lib/treasury/review-assemble";

type RouteContext = { params: Promise<{ clientId: string; reviewId: string }> };

/**
 * Spec B19 Phase B — live Study preview (read-only compute).
 * Same window + compute path as publish; does not write an Edition.
 */
export async function POST(request: Request, context: RouteContext) {
  const { clientId, reviewId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let bodyWindow: StudyDateWindow | null | undefined;
  try {
    const body = (await request.json()) as { window?: StudyDateWindow | null };
    if (body.window === null) bodyWindow = null;
    else if (body.window !== undefined) {
      if (!isStudyDateWindow(body.window)) {
        return NextResponse.json(
          { error: "Invalid window: require {from,to} YYYY-MM-DD with to >= from" },
          { status: 400 }
        );
      }
      bodyWindow = parseStudyDateWindow(body.window);
    }
  } catch {
    /* empty body ok */
  }

  const { data: reviewRow, error: revErr } = await guard.admin
    .from("treasury_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("tenant_id", guard.grant.tenantId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (revErr || !reviewRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const review = normalizeReviewRow(reviewRow as Record<string, unknown>);
  // Explicit body window wins; else study.window; else trailing-12.
  const window = resolveEffectiveStudyWindow(
    bodyWindow === undefined ? undefined : bodyWindow,
    review.window
  );

  const { data: blockRows } = await guard.admin
    .from("treasury_review_blocks")
    .select("*")
    .eq("review_id", reviewId)
    .order("position", { ascending: true });

  const blocks = (blockRows ?? []).map((r) =>
    normalizeBlockRow(r as Record<string, unknown>)
  );

  const snapshot = await buildReviewSnapshot(
    guard.admin,
    review,
    blocks,
    review.current_version + 1,
    "preview",
    new Date().toISOString().slice(0, 10),
    window
  );

  return NextResponse.json({
    ok: true,
    window,
    snapshot,
    persisted: false,
  });
}
