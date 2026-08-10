import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { subtractMonths, todayIso } from "@/lib/treasury/period-bounds";
import type {
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import {
  composeCashModelResponse,
  type CashModelComposedResponse,
  type CashModelLoadedInputs,
} from "@/lib/treasury/cash-model-compose";
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

export type CashModelResponse = CashModelComposedResponse;

export async function loadCashModelInputs(
  admin: AdminClient,
  clientUserId: string,
  accountId: string,
  asOf?: string
): Promise<CashModelLoadedInputs> {
  const asOfDate = (asOf ?? todayIso()).slice(0, 10);
  // subtractMonths returns YYYY-MM-DD — do not append another "-01"
  const from = subtractMonths(asOfDate, 36);

  const categorySeries = await loadMonthlyByCategory(admin, clientUserId, {
    accountId,
    from,
    to: asOfDate,
  });

  const bufferMeta = await loadAccountBuffer(admin, clientUserId, accountId);

  return {
    accountId,
    asOf: asOfDate,
    openingBalance: bufferMeta.value ?? 0,
    openingBalanceRaw: bufferMeta.value,
    categorySeries,
  };
}

export async function computeTreasuryCashModel(
  admin: AdminClient,
  clientUserId: string,
  req: CashModelRequest
): Promise<CashModelResponse> {
  const inputs = await loadCashModelInputs(admin, clientUserId, req.accountId, req.asOf);
  return composeCashModelResponse(inputs, req.params, req.scenarios);
}
