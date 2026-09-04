/**
 * Spec B16 — server-only placed study builder (live cash-model recompute).
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  isCashModelParams,
  isCashModelScenarioArray,
  type CashModelDerivedSnapshot,
  type CashModelParams,
} from "@/lib/treasury/cash-model-types";
import { composeCashModelResponse } from "@/lib/treasury/cash-model-compose";
import { loadCashModelInputs } from "@/lib/server/treasury-cash-model";
import type { ExternalModelDerivedSnapshot } from "@/lib/treasury/studies";
import {
  isStudyPlaceable,
  placedStudyFromCashModelCompute,
  placedStudyFromExternal,
  type PlacedStudySnapshot,
} from "@/lib/treasury/study-assemble";

type Admin = SupabaseClient<Database>;

/**
 * Build a fresh placed snapshot from a treasury_studies row.
 * For cash_model, recomputes timeline from live ledger inputs.
 */
export async function buildPlacedStudySnapshot(
  admin: Admin,
  clientUserId: string,
  studyRow: Record<string, unknown>,
  opts?: { manualOpeningBalance?: number | null }
): Promise<PlacedStudySnapshot | null> {
  const type = String(studyRow.type ?? "");
  const id = String(studyRow.id);
  const name = String(studyRow.name ?? "Study");
  const status = studyRow.status != null ? String(studyRow.status) : null;

  if (!isStudyPlaceable({ type, status })) return null;

  if (type === "external_model") {
    return placedStudyFromExternal({
      id,
      name,
      derived_snapshot: studyRow.derived_snapshot as ExternalModelDerivedSnapshot,
    });
  }

  if (type === "cash_model") {
    const params = studyRow.params;
    const scenarios = studyRow.scenarios;
    if (!isCashModelParams(params) || !isCashModelScenarioArray(scenarios)) {
      return null;
    }
    const scope = studyRow.scope as { accountId?: string } | null;
    const accountId = scope?.accountId ?? null;
    const inputs = await loadCashModelInputs(admin, clientUserId, accountId);
    let openingSource: "ledger" | "manual" | "unknown" =
      inputs.openingBalanceRaw != null ? "ledger" : "unknown";

    const paramsWithManual = params as CashModelParams & {
      manualOpeningBalance?: number;
    };
    if (opts?.manualOpeningBalance != null) {
      inputs.openingBalance = opts.manualOpeningBalance;
      inputs.openingBalanceRaw = opts.manualOpeningBalance;
      openingSource = "manual";
    } else if (typeof paramsWithManual.manualOpeningBalance === "number") {
      inputs.openingBalance = paramsWithManual.manualOpeningBalance;
      inputs.openingBalanceRaw = paramsWithManual.manualOpeningBalance;
      openingSource = "manual";
    }

    const composed = composeCashModelResponse(inputs, params, scenarios);
    const derived: CashModelDerivedSnapshot = {
      ...composed.derived_snapshot,
      openingBalance: inputs.openingBalanceRaw,
    };

    return placedStudyFromCashModelCompute({
      studyId: id,
      name,
      asOf: composed.asOf,
      openingBalanceRaw: inputs.openingBalanceRaw,
      openingBalanceSource: openingSource,
      timeline: composed.timeline,
      summaries: composed.summaries,
      params,
      scenarios,
      derived,
    });
  }

  return null;
}
