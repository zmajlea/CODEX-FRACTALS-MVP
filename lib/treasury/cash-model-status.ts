/**
 * Spec 65 Part F — runway status chip (green / amber / red).
 */

import type { CashModelScenarioSummary } from "@/lib/treasury/cash-model";
import type { CashModelParams, CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";

function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function summaryFor(
  summaries: CashModelScenarioSummary[],
  scenarioId: string
): CashModelScenarioSummary | undefined {
  return summaries.find((s) => s.scenarioId === scenarioId);
}

export function buildRunwayStatus(
  summaries: CashModelScenarioSummary[],
  params: CashModelParams
): CashModelRunwayStatus {
  const selected =
    summaryFor(summaries, params.selectedScenarioId) ??
    summaryFor(summaries, "base");
  const downside = summaryFor(summaries, "downside");

  const selectedBreaches = selected != null && !selected.noBreachInHorizon;
  const downsideBreaches = downside != null && !downside.noBreachInHorizon;

  let level: CashModelRunwayStatus["level"] = "green";
  if (selectedBreaches) level = "red";
  else if (downsideBreaches) level = "amber";

  const runwayPart =
    selected?.noBreachInHorizon
      ? `No breach · ${params.horizon}mo horizon`
      : selected?.runwayMonths != null
        ? `Runway ${selected.runwayMonths}mo`
        : "Runway —";

  const breachPart =
    selected?.breachMonth && selectedBreaches
      ? ` · breach ${monthLabel(selected.breachMonth)}`
      : "";

  const downsidePart =
    downside?.breachMonth && downsideBreaches
      ? ` (Downside: ${monthLabel(downside.breachMonth)})`
      : "";

  return {
    level,
    label: `${runwayPart}${breachPart}${downsidePart}`.trim(),
    selectedRunwayMonths: selected?.runwayMonths ?? null,
    selectedBreachMonth: selected?.breachMonth ?? null,
    downsideBreachMonth: downside?.breachMonth ?? null,
    noBreachInHorizon: selected?.noBreachInHorizon ?? false,
  };
}
