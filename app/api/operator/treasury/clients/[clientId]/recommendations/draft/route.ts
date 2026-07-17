import { NextResponse } from "next/server";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import {
  findOpenDraft,
  resolveEvidenceLive,
} from "@/lib/server/treasury-recommendation-evidence";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const draft = await findOpenDraft(guard.admin, clientId, guard.user.id);

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "recommendations",
  });

  if (!draft) {
    return NextResponse.json({ draft: null, items: [], missingCount: 0 });
  }

  const { items, missingCount } = await resolveEvidenceLive(
    guard.admin,
    clientId,
    draft.evidence
  );

  return NextResponse.json({ draft, items, missingCount });
}
