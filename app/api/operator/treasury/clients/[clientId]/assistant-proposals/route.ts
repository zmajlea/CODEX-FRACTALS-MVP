import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string }> };

/**
 * Spec B3 Part D — aggregate pending assistant proposals for the client.
 * Spec B8: metrics are not proposals (they land active); only rules/recs/studies.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const [rules, recs, studies] = await Promise.all([
    guard.admin
      .from("treasury_rules")
      .select("id, name, match_merchant, assign_label, status, source, created_at")
      .eq("client_user_id", clientId)
      .eq("status", "proposed")
      .eq("source", "mcp")
      .order("created_at", { ascending: false }),
    guard.admin
      .from("treasury_recommendations")
      .select("id, title, kind, category, status, source, created_at")
      .eq("client_user_id", clientId)
      .eq("status", "draft")
      .eq("source", "mcp")
      .order("created_at", { ascending: false }),
    guard.admin
      .from("treasury_studies")
      .select("id, name, type, status, source, derived_snapshot, created_at")
      .eq("client_user_id", clientId)
      .eq("type", "external_model")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  const err =
    rules.error?.message || recs.error?.message || studies.error?.message;
  if (err) {
    return NextResponse.json({ error: err }, { status: 500 });
  }

  return NextResponse.json({
    rules: rules.data ?? [],
    recommendations: recs.data ?? [],
    studies: studies.data ?? [],
  });
}
