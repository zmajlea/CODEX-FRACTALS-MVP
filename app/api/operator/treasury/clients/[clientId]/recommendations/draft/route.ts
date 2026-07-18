import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  findOpenDrafts,
  resolveEvidenceLive,
} from "@/lib/server/treasury-recommendation-evidence";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const drafts = await findOpenDrafts(guard.admin, clientId, guard.user.id);

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "recommendations",
  });

  const recommendation = drafts.recommendation
    ? await resolveEvidenceLive(guard.admin, clientId, drafts.recommendation.evidence)
    : { items: [], missingCount: 0 };
  const question = drafts.question
    ? await resolveEvidenceLive(guard.admin, clientId, drafts.question.evidence)
    : { items: [], missingCount: 0 };

  return NextResponse.json({
    recommendation: drafts.recommendation
      ? {
          draft: drafts.recommendation,
          items: recommendation.items,
          missingCount: recommendation.missingCount,
        }
      : null,
    question: drafts.question
      ? {
          draft: drafts.question,
          items: question.items,
          missingCount: question.missingCount,
        }
      : null,
  });
}
