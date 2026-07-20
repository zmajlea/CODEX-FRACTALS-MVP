import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeOperatorTreasuryReadAudit } from "@/lib/server/operator-treasury-audit";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";

type RouteContext = { params: Promise<{ clientId: string }> };

const PAGE = 1000;

async function collectColumn(
  admin: SupabaseClient,
  clientId: string,
  table: "treasury_transactions" | "treasury_rules",
  column: "label" | "suggested_label" | "assign_label"
) {
  const out = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(column)
      .eq("client_user_id", clientId)
      .not(column, "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data) {
      const v = (row as Record<string, string | null>)[column];
      if (typeof v === "string" && v.trim()) out.add(v.trim());
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function GET(_request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  await writeOperatorTreasuryReadAudit(guard.admin, {
    actorUserId: guard.user.id,
    clientUserId: clientId,
    tenantId: guard.grant.tenantId,
    grantId: guard.grant.grantId,
    surface: "labels",
  });

  try {
    const [confirmed, suggested, fromRules] = await Promise.all([
      collectColumn(guard.admin, clientId, "treasury_transactions", "label"),
      collectColumn(
        guard.admin,
        clientId,
        "treasury_transactions",
        "suggested_label"
      ),
      collectColumn(guard.admin, clientId, "treasury_rules", "assign_label"),
    ]);

    const labels = [
      ...new Set([...confirmed, ...suggested, ...fromRules]),
    ].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ labels });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load labels" },
      { status: 500 }
    );
  }
}
