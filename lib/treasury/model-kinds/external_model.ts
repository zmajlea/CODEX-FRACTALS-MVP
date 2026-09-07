/**
 * external_model — identity over derived_snapshot.results (MCP / manual Summit).
 */
import { z } from "zod";
import type { ExternalModelDerivedSnapshot } from "@/lib/treasury/studies";
import { placedStudyFromExternal } from "@/lib/treasury/study-assemble";
import type { ModelKindDef, ModelRowLike } from "@/lib/treasury/model-kinds/types";

export const externalModelParamsSchema = z.record(z.string(), z.unknown());
export const externalModelScenariosSchema = z.array(z.unknown());

const EXTERNAL_EXPLAIN =
  "Operator- or assistant-authored results; arithmetic checked at submit; identity compute.";

export type ExternalModelComputeResult = {
  derived: ExternalModelDerivedSnapshot;
};

export const externalModelKind: ModelKindDef<
  Record<string, unknown>,
  unknown[],
  ExternalModelComputeResult
> = {
  type: "external_model",
  label: "External",
  description: "Validated external results (spreadsheet / MCP) placed as a Model.",
  family: "external",
  listed: true,
  params: externalModelParamsSchema,
  scenarios: externalModelScenariosSchema,
  form: [],
  inputs: [],
  placeable(row) {
    return row.status === "confirmed";
  },
  asOf(row) {
    const d = row.derived_snapshot as ExternalModelDerivedSnapshot | null;
    const results = d?.results as { as_of?: string } | undefined;
    return String(results?.as_of ?? d?.submittedAt ?? "").slice(0, 10);
  },
  compute(_inputs, _params, _scenarios, row) {
    const derived = row.derived_snapshot as ExternalModelDerivedSnapshot | null;
    if (!derived?.results || typeof derived.results !== "object") return null;
    return { derived };
  },
  toSnapshot(row, _inputs, _params, _scenarios, result) {
    return placedStudyFromExternal({
      id: String(row.id ?? "preview"),
      name: String(row.name ?? "External"),
      derived_snapshot: result.derived,
    });
  },
  confidence() {
    return {
      grade: "solid",
      reasons: ["Operator-authored; arithmetic checked at submit"],
      historyMonthCount: 0,
    };
  },
  explain() {
    return EXTERNAL_EXPLAIN;
  },
  derived(result) {
    return result.derived as unknown as Record<string, unknown>;
  },
};

export function externalModelRowAsOf(row: ModelRowLike): string {
  return externalModelKind.asOf(row);
}
