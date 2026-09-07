/**
 * spend_plan — hidden legacy kind. Not listed, not placeable.
 * Preserves null / non-placeable behavior for any leftover rows.
 */
import { z } from "zod";
import { SPEND_PLAN_METHOD_NOTE } from "@/lib/treasury/spend-plan";
import type { ModelKindDef } from "@/lib/treasury/model-kinds/types";
import type { PlacedStudySnapshot } from "@/lib/treasury/study-assemble";

export const spendPlanKind: ModelKindDef<unknown, unknown[], null> = {
  type: "spend_plan",
  label: "Spend plan (legacy)",
  description: "Legacy spend-plan model — not placeable on Studies.",
  family: "legacy",
  listed: false,
  params: z.unknown(),
  scenarios: z.array(z.unknown()),
  form: [],
  inputs: [],
  placeable() {
    return false;
  },
  asOf() {
    return "";
  },
  compute() {
    return null;
  },
  toSnapshot(): PlacedStudySnapshot {
    // Unreachable while placeable is false; satisfy the contract.
    throw new Error("spend_plan is not placeable");
  },
  confidence() {
    return {
      grade: "refused",
      reasons: ["Legacy spend_plan is not placeable"],
      historyMonthCount: 0,
    };
  },
  explain() {
    return SPEND_PLAN_METHOD_NOTE;
  },
};
