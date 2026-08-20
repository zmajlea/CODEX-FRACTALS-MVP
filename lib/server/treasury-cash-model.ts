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
  /** Spec B6 — omit/null = all client accounts. */
  accountId?: string | null;
  params: CashModelParams;
  scenarios: CashModelScenario[];
  asOf?: string;
};

export type CashModelResponse = CashModelComposedResponse;

export async function loadCashModelInputs(
  admin: AdminClient,
  clientUserId: string,
  accountId?: string | null,
  asOf?: string
): Promise<CashModelLoadedInputs> {
  const asOfDate = (asOf ?? todayIso()).slice(0, 10);
  const from = subtractMonths(asOfDate, 36);
  const acct = accountId?.trim() || null;

  const categorySeries = await loadMonthlyByCategory(admin, clientUserId, {
    accountId: acct,
    from,
    to: asOfDate,
  });

  const bufferMeta = acct
    ? await loadAccountBuffer(admin, clientUserId, acct)
    : { value: null as number | null, source: null };

  return {
    accountId: acct ?? "__all__",
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
  const inputs = await loadCashModelInputs(
    admin,
    clientUserId,
    req.accountId,
    req.asOf
  );
  return composeCashModelResponse(inputs, req.params, req.scenarios);
}
