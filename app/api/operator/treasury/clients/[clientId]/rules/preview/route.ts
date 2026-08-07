import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  countRuleMatches,
  fetchRuleMatchPage,
  type RuleMatchType,
} from "@/lib/treasury/rule-predicate";

type RouteContext = { params: Promise<{ clientId: string }> };

/**
 * Spec 63 — rule preview counts/samples via shared predicate (not ledger q).
 */
export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "q required" }, { status: 400 });
  }

  const directionRaw = url.searchParams.get("direction");
  const amountMinRaw = url.searchParams.get("amount_min");
  const amountMaxRaw = url.searchParams.get("amount_max");
  const labeled = url.searchParams.get("labeled");
  const matchType = (url.searchParams.get("match_type") ??
    "contains") as RuleMatchType;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 3), 50);
  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");

  const direction: "in" | "out" | null =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;

  const match = {
    payeeQuery: q,
    matchType,
    direction,
    amount_min:
      amountMinRaw != null && amountMinRaw !== ""
        ? Number(amountMinRaw)
        : null,
    amount_max:
      amountMaxRaw != null && amountMaxRaw !== ""
        ? Number(amountMaxRaw)
        : null,
    date_from: dateFrom,
    date_to: dateTo,
  };

  try {
    // Spec 64 — live list and will_suggest share one predicate path (labelNullOnly).
    // When labeled=false, page rows are the will_suggest set so "N of M" cannot drift.
    const labelNullOnly = labeled === "false";
    const [total, willSuggest, samples] = await Promise.all([
      countRuleMatches(guard.admin, clientId, match, {
        labelNullOnly: false,
      }),
      countRuleMatches(guard.admin, clientId, match, {
        labelNullOnly: true,
      }),
      fetchRuleMatchPage(guard.admin, clientId, match, {
        labelNullOnly,
        offset: 0,
        limit,
      }),
    ]);

    return NextResponse.json({
      total,
      willSuggest: labelNullOnly ? willSuggest : total,
      will_suggest: willSuggest,
      payeeMatch: total,
      conditionedMatch: total,
      transactions: samples,
    });
  } catch (e) {
    console.error("[rule-preview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preview failed" },
      { status: 500 }
    );
  }
}
