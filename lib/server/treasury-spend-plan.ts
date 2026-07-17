import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMonths,
  startOfMonth,
  subtractMonths,
  todayIso,
} from "@/lib/treasury/period-bounds";
import {
  buildSpendPlanFromHistory,
  computeL0,
  defaultPlanStartMonth,
  deriveCompleteMonths,
  deriveDataSpan,
  excludedPartialMonthBeforeStart,
  fillCompleteMonthAmounts,
  lastNFromCompleteMonths,
  roundBaseDefault,
  type BacktestSpendPlanParams,
  type SpendPlanHistoryResponse,
  type SpendPlanResponse,
} from "@/lib/treasury/spend-plan";
import { loadMonthlyOutflows } from "@/lib/treasury/load-monthly-outflows";
import type { Database } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type SpendPlanRequest = {
  accountId: string;
  label?: string;
  base?: number;
  step?: number;
  stepEveryMonths?: number;
  horizon?: number;
  startMonth?: string;
  startingBuffer?: number;
  asOf?: string;
  mode?: "projection" | "backtest" | "both";
  backtestStart?: string;
  backtestMonths?: number;
};

function monthKeyFromDate(postedDate: string): string {
  return startOfMonth(postedDate.slice(0, 10));
}

export async function loadAccountBuffer(
  admin: AdminClient,
  clientUserId: string,
  accountId: string
): Promise<{
  value: number | null;
  source: "available_balance" | "current_balance" | null;
}> {
  const { data, error } = await admin
    .from("treasury_accounts")
    .select("available_balance, current_balance")
    .eq("client_user_id", clientUserId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { value: null, source: null };
  if (data.available_balance != null) {
    return { value: Number(data.available_balance), source: "available_balance" };
  }
  if (data.current_balance != null) {
    return { value: Number(data.current_balance), source: "current_balance" };
  }
  return { value: null, source: null };
}

export async function loadSpendPlanHistory(
  admin: AdminClient,
  clientUserId: string,
  req: { accountId: string; label?: string; asOf?: string }
): Promise<SpendPlanHistoryResponse> {
  const asOf = req.asOf ?? todayIso();
  const monthlyOutflows = await loadMonthlyOutflows(admin, clientUserId, {
    accountId: req.accountId,
    label: req.label,
    from: "2020-01-01",
    to: asOf,
  });

  const completeMonths = deriveCompleteMonths(monthlyOutflows, asOf);
  const { firstMonth } = deriveDataSpan(monthlyOutflows);
  const lastCompleteMonth =
    completeMonths.length > 0
      ? completeMonths[completeMonths.length - 1]!
      : null;
  const planStart = defaultPlanStartMonth(asOf);
  const excludedPartialMonth = excludedPartialMonthBeforeStart(planStart, asOf);
  const bufferMeta = await loadAccountBuffer(admin, clientUserId, req.accountId);

  return {
    accountId: req.accountId,
    label: req.label ?? null,
    asOf: asOf.slice(0, 10),
    monthlyOutflows,
    completeMonths,
    excludedPartialMonth,
    buffer: bufferMeta.value != null
      ? {
          value: bufferMeta.value,
          source: bufferMeta.source,
          asOf: asOf.slice(0, 10),
        }
      : null,
    historyMonthCount: completeMonths.length,
    firstMonth,
    lastCompleteMonth,
  };
}

function buildBacktestDebits(
  filled: Record<string, number>,
  btStart: string,
  btMonths: number
): Record<string, number> {
  const debits: Record<string, number> = {};
  for (let i = 0; i < btMonths; i++) {
    const m = addMonths(btStart, i);
    debits[m] = filled[m] ?? 0;
  }
  return debits;
}

export async function computeSpendPlan(
  admin: AdminClient,
  clientUserId: string,
  req: SpendPlanRequest
): Promise<SpendPlanResponse> {
  const asOf = req.asOf ?? todayIso();
  const monthlyDebits = await loadMonthlyOutflows(admin, clientUserId, {
    accountId: req.accountId,
    label: req.label,
    from: "2020-01-01",
    to: asOf,
  });

  const completeMonths = deriveCompleteMonths(monthlyDebits, asOf);
  const filled = fillCompleteMonthAmounts(monthlyDebits, completeMonths);
  const l0Window = lastNFromCompleteMonths(completeMonths, 6);
  const l0 = computeL0(filled, l0Window) ?? 0;

  const planStart = req.startMonth
    ? startOfMonth(`${req.startMonth}-01`)
    : defaultPlanStartMonth(asOf);

  const bufferMeta = await loadAccountBuffer(admin, clientUserId, req.accountId);
  const startingBuffer =
    req.startingBuffer ?? bufferMeta.value ?? 0;
  const base = req.base ?? roundBaseDefault(l0);
  const step = req.step ?? 0;
  const stepEveryMonths = req.stepEveryMonths ?? 3;
  const horizon = req.horizon ?? 24;
  const mode = req.mode ?? "both";

  let backtest: BacktestSpendPlanParams | undefined;
  if (mode === "backtest" || mode === "both") {
    const btMonths =
      req.backtestMonths ?? Math.min(12, Math.max(completeMonths.length, 1));
    const btStart = req.backtestStart
      ? startOfMonth(`${req.backtestStart}-01`)
      : completeMonths.length >= btMonths
        ? completeMonths[completeMonths.length - btMonths]!
        : completeMonths[0] ?? subtractMonths(planStart, btMonths);

    backtest = {
      startMonth: btStart,
      startingBuffer: 0,
      base,
      step,
      stepEveryMonths,
      actualDebits: buildBacktestDebits(filled, btStart, btMonths),
      monthCount: btMonths,
    };
  }

  return buildSpendPlanFromHistory({
    planStartMonth: planStart,
    asOf,
    horizon: mode === "backtest" ? 0 : horizon,
    startingBuffer,
    base,
    step,
    stepEveryMonths,
    monthlyDebits,
    backtest: mode === "projection" ? undefined : backtest,
  });
}
