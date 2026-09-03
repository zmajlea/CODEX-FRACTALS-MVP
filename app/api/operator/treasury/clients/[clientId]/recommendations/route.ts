import { NextResponse } from "next/server";
import {
  writeOperatorTreasuryReadAudit,
  writeTreasuryAudit,
} from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  computeRecommendationRollup,
  verifyRecommendationAnchor,
} from "@/lib/server/treasury-recommendations";
import { normalizeRecommendationRow } from "@/lib/server/treasury-recommendation-evidence";
import {
  isImpactBasis,
  isRecommendationCategory,
} from "@/lib/treasury/recommendation-status";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";
import type { Database } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const { data, error } = await guard.admin
    .from("treasury_recommendations")
    .select("*")
    .eq("client_user_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recommendations = (data ?? []).map((row) =>
    normalizeRecommendationRow(row as Record<string, unknown>)
  );
  const rollup = computeRecommendationRollup(recommendations);

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "recommendations",
  });

  return NextResponse.json({ recommendations, rollup });
}

type PostBody = {
  title?: string;
  category?: string;
  why?: string;
  kind?: "recommendation" | "question";
  impact_amount?: number | null;
  impact_unit?: string | null;
  impact_basis?: string | null;
  anchor_type?: "account" | "general";
  anchor_ref?: { account_id?: string } | null;
  send?: boolean;
};

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim();
  const category = body.category?.trim();
  const whyRaw = body.why?.trim() ?? "";
  const anchorType = body.anchor_type ?? "general";
  const sending = body.send === true;

  // Spec B15-FIXES: drafts may be empty until send; require why only when sealing.
  if (!title || !category || (sending && !whyRaw)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!isRecommendationCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (body.impact_basis != null && body.impact_basis !== "" && !isImpactBasis(body.impact_basis)) {
    return NextResponse.json({ error: "Invalid impact basis" }, { status: 400 });
  }

  let anchorRef: Database["public"]["Tables"]["treasury_recommendations"]["Insert"]["anchor_ref"] =
    null;

  if (anchorType === "account") {
    const accountId = body.anchor_ref?.account_id?.trim();
    if (!accountId) {
      return NextResponse.json({ error: "Account anchor required" }, { status: 400 });
    }
    const verified = await verifyRecommendationAnchor(guard.admin, clientId, accountId);
    if (!verified) {
      return NextResponse.json({ error: "Account not found for client" }, { status: 400 });
    }
    anchorRef = verified;
  }

  const now = new Date().toISOString();
  const why = whyRaw || " ";

  const insert: Database["public"]["Tables"]["treasury_recommendations"]["Insert"] = {
    client_user_id: clientId,
    operator_tenant_id: guard.grant.tenantId,
    created_by: guard.user.id,
    title,
    category,
    why,
    kind: body.kind === "question" ? "question" : "recommendation",
    impact_amount: body.impact_amount ?? null,
    impact_unit: body.impact_unit?.trim() || null,
    impact_basis: body.impact_basis ? (body.impact_basis as "per_month" | "per_year" | "one_time") : null,
    anchor_type: anchorType,
    anchor_ref: anchorRef,
    status: sending ? "sent" : "draft",
    ...(sending
      ? {
          sealed_at: now,
          sealed_by: guard.user.id,
          sent_at: now,
        }
      : {}),
  };

  const { data: rec, error } = await guard.admin
    .from("treasury_recommendations")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeTreasuryAudit(guard.admin, {
    actorUserId: guard.user.id,
    eventType: "treasury_recommendation_created",
    payload: {
      client_user_id: clientId,
      recommendation_id: rec.id,
      status: rec.status,
    },
  });

  if (sending) {
    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_recommendation_sealed",
      payload: {
        client_user_id: clientId,
        recommendation_id: rec.id,
        sealed_at: now,
      },
    });
  }

  return NextResponse.json({ recommendation: rec });
}
