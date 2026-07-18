import { NextResponse } from "next/server";
import {
  isGuardResponse,
  requireOperatorTreasuryGrant,
} from "@/lib/server/operator-treasury-route";
import { loadMonthSeriesTransactions } from "@/lib/treasury/load-month-series-transactions";

type RouteContext = { params: Promise<{ clientId: string }> };

/** Analyzer month drill — same filters as loadMonthlyOutflows for that month. */
export async function GET(request: Request, context: RouteContext) {
  const { clientId } = await context.params;
  const guard = await requireOperatorTreasuryGrant(clientId);
  if (isGuardResponse(guard)) return guard;

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account_id")?.trim();
  const month = url.searchParams.get("month")?.trim();
  const label = url.searchParams.get("label")?.trim() || undefined;

  if (!accountId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "account_id and month (YYYY-MM) required" },
      { status: 400 }
    );
  }

  try {
    const { transactions, outflowTotal } = await loadMonthSeriesTransactions(
      guard.admin,
      clientId,
      { accountId, label, monthYm: month }
    );
    return NextResponse.json({
      transactions,
      outflowTotal,
      month,
      accountId,
      label: label ?? null,
      count: transactions.length,
    });
  } catch (e) {
    console.error("[spend-plan/month-series]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load month" },
      { status: 500 }
    );
  }
}
