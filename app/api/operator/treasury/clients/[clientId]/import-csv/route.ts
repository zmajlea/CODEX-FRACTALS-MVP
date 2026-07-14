import { NextResponse } from "next/server";
import { writeTreasuryAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { upsertTransactions } from "@/lib/server/treasury-ingest";
import { applyRulesForClient } from "@/lib/server/treasury-rules";
import { parseTreasuryCsv, upsertCsvAccounts } from "@/lib/treasury/csv-import";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const csvText = await file.text();

  try {
    const parsed = parseTreasuryCsv(csvText, clientId);
    await upsertCsvAccounts(guard.admin, clientId, parsed.accountLabels);
    const result = await upsertTransactions(
      guard.admin,
      clientId,
      parsed.rows,
      "csv"
    );

    await applyRulesForClient(guard.admin, clientId);

    await writeTreasuryAudit(guard.admin, {
      actorUserId: guard.user.id,
      eventType: "treasury_csv_import",
      payload: {
        client_user_id: clientId,
        tenant_id: guard.grant.tenantId,
        imported: result.upserted,
        skipped: parsed.skipped,
      },
    });

    return NextResponse.json({
      imported: result.upserted,
      skipped: parsed.skipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
