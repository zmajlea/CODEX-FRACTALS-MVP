/**
 * Spec 65 Part G — intervention proposals (computed, not applied).
 */

import { computeCashModel, type CashModelComputeInput } from "@/lib/treasury/cash-model";
import type {
  CashModelBucketKey,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";

export type CashModelIntervention = {
  id: string;
  label: string;
  description: string;
  bucket: CashModelBucketKey;
  /** Multiplier applied to scenario factor (e.g. 1.1 = +10% collections). */
  factorMultiplier: number;
  horizonBenefit: number;
  clearsBreach: boolean;
  newBreachMonth: string | null;
  newRunwayMonths: number | null;
};

type InterventionTemplate = {
  id: string;
  label: string;
  bucket: CashModelBucketKey;
  factorMultiplier: number;
};

const TEMPLATES: InterventionTemplate[] = [
  { id: "collections-5", label: "+5% collections", bucket: "collections", factorMultiplier: 1.05 },
  { id: "collections-10", label: "+10% collections", bucket: "collections", factorMultiplier: 1.1 },
  { id: "collections-15", label: "+15% collections", bucket: "collections", factorMultiplier: 1.15 },
  { id: "collections-20", label: "+20% collections", bucket: "collections", factorMultiplier: 1.2 },
  { id: "opex-5", label: "−5% opex", bucket: "opex", factorMultiplier: 0.95 },
  { id: "opex-10", label: "−10% opex", bucket: "opex", factorMultiplier: 0.9 },
  { id: "opex-15", label: "−15% opex", bucket: "opex", factorMultiplier: 0.85 },
  { id: "payroll-5", label: "−5% payroll", bucket: "payroll", factorMultiplier: 0.95 },
  { id: "payroll-10", label: "−10% payroll", bucket: "payroll", factorMultiplier: 0.9 },
];

function buildComputeInput(
  base: CashModelComputeInput,
  scenarios: CashModelScenario[]
): CashModelComputeInput {
  return { ...base, scenarios };
}

export function scenariosWithIntervention(
  scenarios: CashModelScenario[],
  selectedScenarioId: string,
  bucket: CashModelBucketKey,
  factorMultiplier: number
): CashModelScenario[] {
  return scenarios.map((s) => {
    if (s.id !== selectedScenarioId) return s;
    return {
      ...s,
      factors: {
        ...s.factors,
        [bucket]: (s.factors[bucket] ?? 1) * factorMultiplier,
      },
      source: "user-provided" as const,
    };
  });
}

function projectedNcfTotal(timeline: { kind: string; ncf: number }[]): number {
  return timeline
    .filter((r) => r.kind === "projected")
    .reduce((sum, r) => sum + r.ncf, 0);
}

function summaryFor(
  summaries: { scenarioId: string; breachMonth: string | null; runwayMonths: number | null; noBreachInHorizon: boolean }[],
  scenarioId: string
) {
  return summaries.find((s) => s.scenarioId === scenarioId);
}

export function computeCashModelInterventions(
  input: CashModelComputeInput,
  selectedScenarioId: string
): CashModelIntervention[] {
  const base = computeCashModel(input);
  if (base.refused) return [];

  const baseSummary = summaryFor(base.summaries, selectedScenarioId);
  const baseTimeline = base.timeline;
  const baseProjectedNcf = projectedNcfTotal(baseTimeline);

  const candidates: CashModelIntervention[] = [];

  for (const tpl of TEMPLATES) {
    const nextScenarios = scenariosWithIntervention(
      input.scenarios,
      selectedScenarioId,
      tpl.bucket,
      tpl.factorMultiplier
    );
    const next = computeCashModel(buildComputeInput(input, nextScenarios));
    if (next.refused) continue;

    const nextSummary = summaryFor(next.summaries, selectedScenarioId);
    const nextProjectedNcf = projectedNcfTotal(next.timeline);
    const horizonBenefit = nextProjectedNcf - baseProjectedNcf;

    let description = `$${Math.round(horizonBenefit).toLocaleString()} benefit over horizon`;
    if (nextSummary?.noBreachInHorizon) {
      description = `Clears the floor · ${description}`;
    } else if (nextSummary?.breachMonth && baseSummary?.breachMonth) {
      description = `Pushes breach to ${nextSummary.breachMonth.slice(0, 7)} · ${description}`;
    }

    candidates.push({
      id: tpl.id,
      label: tpl.label,
      description,
      bucket: tpl.bucket,
      factorMultiplier: tpl.factorMultiplier,
      horizonBenefit,
      clearsBreach: nextSummary?.noBreachInHorizon ?? false,
      newBreachMonth: nextSummary?.breachMonth ?? null,
      newRunwayMonths: nextSummary?.runwayMonths ?? null,
    });
  }

  candidates.sort((a, b) => {
    if (a.clearsBreach !== b.clearsBreach) return a.clearsBreach ? -1 : 1;
    return b.horizonBenefit - a.horizonBenefit;
  });

  return candidates;
}

/** Smallest single intervention that clears breach, if any. */
export function minimalClearingIntervention(
  interventions: CashModelIntervention[]
): CashModelIntervention | null {
  const clearing = interventions.filter((i) => i.clearsBreach);
  if (!clearing.length) return null;
  return clearing.reduce((best, cur) =>
    Math.abs(cur.factorMultiplier - 1) < Math.abs(best.factorMultiplier - 1) ? cur : best
  );
}

export function toComputeInput(
  inputs: {
    categorySeries: CashModelComputeInput["categorySeries"];
    openingBalance: number;
    asOf: string;
  },
  params: CashModelParams,
  scenarios: CashModelScenario[]
): CashModelComputeInput {
  return {
    categorySeries: inputs.categorySeries,
    bucketMap: params.bucketMap ?? {},
    openingBalance: inputs.openingBalance,
    asOf: inputs.asOf,
    params,
    scenarios,
    excludedMonthSet: new Set(
      (params.excludedMonths ?? []).map((e) => e.month.slice(0, 7))
    ),
  };
}
