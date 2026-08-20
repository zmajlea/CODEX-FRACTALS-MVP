import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { asTreasuryStudyRow } from "@/lib/server/treasury-study-mapper";
import { loadCashModelInputs } from "@/lib/server/treasury-cash-model";
import {
  defaultCashModelParams,
  defaultCashModelScenarios,
  emptyCashModelDerivedSnapshot,
  scaleAwareMinCashThreshold,
} from "@/lib/treasury/cash-model-types";
import type { Json } from "@/lib/database.types";

type RouteContext = { params: Promise<{ clientId: string }> };

type PostBody = {
  /** Spec B6 — optional; omit for client-wide primary. */
  accountId?: string | null;
};

/** Trailing-6 complete months' average monthly outflow (abs outflows). */
function trailingAvgMonthlyOutflow(
  categorySeries: Record<string, Record<string, { in: number; out: number }>>
): number {
  const monthTotals = new Map<string, number>();
  for (const months of Object.values(categorySeries)) {
    for (const [month, cell] of Object.entries(months)) {
      monthTotals.set(month, (monthTotals.get(month) ?? 0) + (cell.out ?? 0));
    }
  }
  const sorted = [...monthTotals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);
  if (sorted.length === 0) return 0;
  const window = sorted.slice(-6);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/** Spec 65/B6 — idempotent primary cash_model (account optional). */
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

  const accountId = body.accountId?.trim() || null;

  let threshold = 500_000;
  try {
    const inputs = await loadCashModelInputs(guard.admin, clientId, accountId);
    const avgOut = trailingAvgMonthlyOutflow(inputs.categorySeries);
    threshold = scaleAwareMinCashThreshold(avgOut);
  } catch {
    // Empty book / loader miss — keep Tim default
  }

  const params = defaultCashModelParams();
  const scenarios = defaultCashModelScenarios(threshold);
  const derived_snapshot = emptyCashModelDerivedSnapshot();

  // RPC maps null → scope accountId "__all__" (not a treasury_accounts uuid).
  const { data: studyId, error: rpcErr } = await guard.admin.rpc(
    "treasury_ensure_primary_cash_model",
    {
      p_client: clientId,
      p_account: accountId,
      p_tenant: guard.grant.tenantId,
      p_actor: guard.user.id,
      p_name: "Cash model",
      p_scope: {
        accountId: accountId ?? "__all__",
        label: null,
      } as unknown as Json,
      p_params: params as unknown as Json,
      p_scenarios: scenarios as unknown as Json,
      p_derived_snapshot: derived_snapshot as unknown as Json,
    }
  );

  if (rpcErr || !studyId) {
    return NextResponse.json(
      { error: rpcErr?.message ?? "Failed to ensure primary cash model" },
      { status: 500 }
    );
  }

  const { data, error } = await guard.admin
    .from("treasury_studies")
    .select("*")
    .eq("id", studyId)
    .eq("client_user_id", clientId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Study not found after ensure" },
      { status: 500 }
    );
  }

  return NextResponse.json({ study: asTreasuryStudyRow(data) });
}
