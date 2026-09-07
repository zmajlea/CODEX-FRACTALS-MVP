/**
 * MODEL_KINDS registry — one entry per treasury_studies.type.
 * Pure module (no server-only). Dispatch lives in study-assemble-server.
 */

import { cashModelKind } from "@/lib/treasury/model-kinds/cash_model";
import { externalModelKind } from "@/lib/treasury/model-kinds/external_model";
import { spendPlanKind } from "@/lib/treasury/model-kinds/spend_plan";
import type { ModelKindDef, ModelRowLike } from "@/lib/treasury/model-kinds/types";

export const MODEL_KINDS = {
  cash_model: cashModelKind,
  external_model: externalModelKind,
  spend_plan: spendPlanKind,
} as const satisfies Record<string, ModelKindDef>;

export type RegisteredModelType = keyof typeof MODEL_KINDS;

export function getModelKind(type: string): ModelKindDef | undefined {
  return MODEL_KINDS[type as RegisteredModelType] as ModelKindDef | undefined;
}

export function isRegisteredModelType(type: string): type is RegisteredModelType {
  return Object.prototype.hasOwnProperty.call(MODEL_KINDS, type);
}

/** Listed kinds for Phase 2 Studio picker (excludes spend_plan). */
export function listedModelKinds(): ModelKindDef[] {
  return Object.values(MODEL_KINDS).filter((k) => k.listed);
}

export function kindPlaceable(row: ModelRowLike): boolean {
  const kind = getModelKind(row.type);
  return kind ? kind.placeable(row) : false;
}

export function kindAsOf(row: ModelRowLike): string {
  const kind = getModelKind(row.type);
  return kind ? kind.asOf(row) : "";
}

export type {
  Confidence,
  InputLoaderKey,
  LoadedInputs,
  ModelFamily,
  ModelKindDef,
  ModelRowLike,
  ParamField,
} from "@/lib/treasury/model-kinds/types";
