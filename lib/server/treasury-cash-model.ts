import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { subtractMonths, todayIso } from "@/lib/treasury/period-bounds";
import {
  computeCashModel,
  type CashModelResult,
} from "@/lib/treasury/cash-model";
import type {
  CashModelDerivedSnapshot,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import { loadMonthlyByCategory } from "@/lib/treasury/load-monthly-by-category";
import { loadAccountBuffer } from "@/lib/server/treasury-spend-plan";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type CashModelRequest = {
  accountId: string;
  params: CashModelParams;
  scenarios: CashModelScenario[];
  asOf?: string;
};

export type CashModelResponse = CashModelResult & {
  accountId: string;
  asOf: string;
  openingBalance: number;
  derived_snapshot: CashModelDerivedSnapshot;
};

export async function computeTreasuryCashModel(
  admin: AdminClient,
  clientUserId: string,
  req: CashModelRequest
): Promise<CashModelResponse> {
  const asOf = (req.asOf ?? todayIso()).slice(0, 10);
  const from = subtractMonths(asOf.slice(0, 7), 36);

  const categorySeries = await loadMonthlyByCategory(admin, clientUserId, {
    accountId: req.accountId,
    from: `${from}-01`,
    to: asOf,
  });

  const bufferMeta = await loadAccountBuffer(admin, clientUserId, req.accountId);
  const openingBalance = bufferMeta.value ?? 0;

  const excludedMonthSet = new Set(
    (req.params.excludedMonths ?? []).map((e) => e.month.slice(0, 7))
  );

  const result = computeCashModel({
    categorySeries,
    bucketMap: req.params.bucketMap ?? {},
    openingBalance,
    asOf,
    params: req.params,
    scenarios: req.scenarios,
    excludedMonthSet,
  });

  const derived_snapshot: CashModelDerivedSnapshot = {
    bucketBaselines: result.bucketBaselines,
    coveragePct: result.coveragePct,
    bucketMap: req.params.bucketMap ?? {},
    openingBalance: bufferMeta.value,
    asOf,
    historyMonthCount: result.completeMonths.length,
    historyDerived: true,
  };

  return {
    ...result,
    accountId: req.accountId,
    asOf,
    openingBalance,
    derived_snapshot,
  };
}
