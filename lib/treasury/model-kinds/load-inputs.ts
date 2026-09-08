/**
 * Generic input loaders for MODEL_KINDS (server-only).
 * Keys are loader names, not kind names — compute stays pure.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  resolveOpeningBalanceOverride,
  type CashModelParams,
} from "@/lib/treasury/cash-model-types";
import { loadCashModelInputs } from "@/lib/server/treasury-cash-model";
import type {
  InputLoaderKey,
  LoadedInputs,
} from "@/lib/treasury/model-kinds/types";

type Admin = SupabaseClient<Database>;

export type LoadInputsOpts = {
  /** Explicit OB override (wins). */
  openingBalance?: number | null;
  /** Used when openingBalance omitted — resolves params.openingBalance. */
  params?: CashModelParams | null;
  asOf?: string;
};

/**
 * Load declared inputs. Phase 1: cash loaders collapse to one
 * `loadCashModelInputs` call (monthly series + buffer + OB rule).
 */
export async function loadInputs(
  admin: Admin,
  clientUserId: string,
  scope: { accountId?: string } | null | undefined,
  keys: InputLoaderKey[],
  opts?: LoadInputsOpts
): Promise<LoadedInputs> {
  const out: LoadedInputs = {};
  if (keys.length === 0) return out;

  const needsCash =
    keys.includes("monthly_by_category") ||
    keys.includes("monthly_by_bucket") ||
    keys.includes("account_buffer");

  if (needsCash) {
    // "__all__" is the all-accounts sentinel stored on scope (mirrors the
    // cash_model path); it is NOT a real account id, so map it to null or the
    // account filter matches nothing and the series loads empty.
    const rawAccount = scope?.accountId ?? null;
    const accountId = rawAccount && rawAccount !== "__all__" ? rawAccount : null;
    const override =
      opts?.openingBalance != null && Number.isFinite(opts.openingBalance)
        ? opts.openingBalance
        : resolveOpeningBalanceOverride(opts?.params ?? null);
    out.cashModel = await loadCashModelInputs(
      admin,
      clientUserId,
      accountId,
      opts?.asOf,
      { openingBalance: override }
    );
  }

  return out;
}
