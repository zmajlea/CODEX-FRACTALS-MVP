/**
 * Spec B16 — server-only placed study builder (live cash-model recompute).
 * Phase 1 — generic MODEL_KINDS dispatch (no per-type if branches).
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resolveOpeningBalanceOverride } from "@/lib/treasury/cash-model-types";
import {
  getModelKind,
  type Confidence,
  type ModelRowLike,
} from "@/lib/treasury/model-kinds";
import { coerceCashModelParams } from "@/lib/treasury/model-kinds/cash_model";
import { loadInputs } from "@/lib/treasury/model-kinds/load-inputs";
import type { PlacedStudySnapshot } from "@/lib/treasury/study-assemble";

type Admin = SupabaseClient<Database>;

export type ModelPreviewResult = {
  snapshot: PlacedStudySnapshot;
  confidence: Confidence;
  explain: string;
};

function asModelRow(studyRow: Record<string, unknown>): ModelRowLike {
  return {
    id: studyRow.id != null ? String(studyRow.id) : undefined,
    name: studyRow.name != null ? String(studyRow.name) : undefined,
    type: String(studyRow.type ?? ""),
    status: studyRow.status != null ? String(studyRow.status) : null,
    params: studyRow.params,
    scenarios: studyRow.scenarios,
    scope: studyRow.scope as { accountId?: string } | null,
    derived_snapshot: studyRow.derived_snapshot,
  };
}

/**
 * Build a fresh placed snapshot from a treasury_studies row via MODEL_KINDS.
 * Opening balance: opts.openingBalance wins; else params.openingBalance via loadInputs.
 */
export async function buildPlacedStudySnapshot(
  admin: Admin,
  clientUserId: string,
  studyRow: Record<string, unknown>,
  opts?: { openingBalance?: number | null }
): Promise<PlacedStudySnapshot | null> {
  const out = await runModelKind(admin, clientUserId, studyRow, opts, {
    requirePlaceable: true,
  });
  return out?.snapshot ?? null;
}

/**
 * Same compute path as place — never persists. For Model Studio preview.
 */
export async function previewModelKind(
  admin: Admin,
  clientUserId: string,
  studyRow: Record<string, unknown>,
  opts?: { openingBalance?: number | null }
): Promise<ModelPreviewResult | null> {
  return runModelKind(admin, clientUserId, studyRow, opts, {
    requirePlaceable: false,
  });
}

async function runModelKind(
  admin: Admin,
  clientUserId: string,
  studyRow: Record<string, unknown>,
  opts: { openingBalance?: number | null } | undefined,
  flags: { requirePlaceable: boolean }
): Promise<ModelPreviewResult | null> {
  const row = asModelRow(studyRow);
  const kind = getModelKind(row.type);
  if (!kind) return null;
  if (flags.requirePlaceable && !kind.placeable(row)) return null;
  // Preview still refuses kinds that can never place (e.g. spend_plan).
  if (!flags.requirePlaceable && !kind.listed && !kind.placeable(row)) {
    return null;
  }

  const parsed = kind.params.safeParse(row.params);
  if (!parsed.success) return null;

  let scenarios: unknown = [];
  if (kind.scenarios) {
    const s = kind.scenarios.safeParse(row.scenarios ?? []);
    if (!s.success) return null;
    scenarios = s.data;
  }

  const paramsForOb =
    row.type === "cash_model" ? coerceCashModelParams(parsed.data) : null;
  const override =
    opts?.openingBalance != null && Number.isFinite(opts.openingBalance)
      ? opts.openingBalance
      : resolveOpeningBalanceOverride(paramsForOb);

  const inputs = await loadInputs(
    admin,
    clientUserId,
    row.scope,
    kind.inputs,
    { openingBalance: override, params: paramsForOb }
  );

  const result = kind.compute(inputs, parsed.data, scenarios as never, row);
  if (result == null) return null;

  const snapshot = kind.toSnapshot(
    row,
    inputs,
    parsed.data,
    scenarios as never,
    result
  );
  return {
    snapshot,
    confidence: kind.confidence(inputs, parsed.data, result),
    explain: kind.explain(parsed.data, result),
  };
}
