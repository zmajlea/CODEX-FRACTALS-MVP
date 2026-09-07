/**
 * Barrel — pure registry exports only (no load-inputs / server-only).
 */
export {
  MODEL_KINDS,
  getModelKind,
  isRegisteredModelType,
  listedModelKinds,
  kindPlaceable,
  kindAsOf,
  type RegisteredModelType,
} from "@/lib/treasury/model-kinds/registry";

export type {
  Confidence,
  InputLoaderKey,
  LoadedInputs,
  ModelFamily,
  ModelKindDef,
  ModelRowLike,
  ParamField,
} from "@/lib/treasury/model-kinds/types";
