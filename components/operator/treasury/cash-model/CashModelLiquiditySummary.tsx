"use client";

import { useMemo } from "react";
import { CashModelCommittedFlowsCard } from "@/components/operator/treasury/cash-model/CashModelCommittedFlowsCard";
import { CashModelExplainChart } from "@/components/operator/treasury/cash-model/CashModelExplainChart";
import { CashModelRunwayChart } from "@/components/operator/treasury/cash-model/CashModelRunwayChart";
import type { CashModelIntervention } from "@/lib/treasury/cash-model-interventions";
import { minimalClearingIntervention } from "@/lib/treasury/cash-model-interventions";
import type {
  CashModelScenarioSummary,
  CashModelTimelineRow,
} from "@/lib/treasury/cash-model";
import type { CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";

type Props = {
  clientUserId: string;
  accountId: string;
  asOf: string;
  horizon: number;
  threshold: number;
  openingBalance: number;
  timeline: CashModelTimelineRow[];
  downsideTimeline?: CashModelTimelineRow[];
  selectedScenarioId: string;
  selectedSummary: CashModelScenarioSummary | undefined;
  runwayStatus: CashModelRunwayStatus | null;
  interventions: CashModelIntervention[];
  onExport?: () => void;
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Spec 65-R Block 4 — Liquidity Summary (client-facing monthly report frame).
 */
export function CashModelLiquiditySummary({
  clientUserId,
  accountId,
  asOf,
  horizon,
  threshold,
  openingBalance,
  timeline,
  downsideTimeline,
  selectedScenarioId,
  selectedSummary,
  runwayStatus,
  interventions,
  onExport,
}: Props) {
  const kpis = useMemo(() => {
    const projected = timeline.filter((r) => r.kind === "projected");
    const actuals = timeline.filter((r) => r.kind === "actual").slice(-6);
    const avgProjectedBurn =
      projected.length > 0
        ? projected.reduce((s, r) => s + r.ncf, 0) / projected.length
        : 0;
    const avgActualNcf =
      actuals.length > 0
        ? actuals.reduce((s, r) => s + r.ncf, 0) / actuals.length
        : null;
    return {
      avgProjectedBurn,
      avgActualNcf,
      minEnding: selectedSummary?.minEnding,
      breachMonth: selectedSummary?.breachMonth ?? null,
      noBreach: selectedSummary?.noBreachInHorizon ?? true,
      runwayMonths: selectedSummary?.runwayMonths ?? null,
      thresholdMargin: selectedSummary?.thresholdMarginAtLow ?? 0,
    };
  }, [timeline, selectedSummary]);

  const clearing = minimalClearingIntervention(interventions);
  const collectionsLine = useMemo(() => {
    const coll = interventions.find(
      (i) => i.bucket === "collections" && i.factorMultiplier === 1.1
    );
    const lead = coll ?? clearing;
    if (!lead) return null;
    if (lead.clearsBreach) {
      return `Collecting ${Math.round((lead.factorMultiplier - 1) * 100)}% faster adds ${fmtMoney(lead.horizonBenefit)} over the horizon and clears the floor.`;
    }
    return `Collecting ${Math.round((lead.factorMultiplier - 1) * 100)}% faster adds ${fmtMoney(lead.horizonBenefit)} over the horizon and moves the breach to ${
      lead.newBreachMonth ? monthLabel(lead.newBreachMonth) : "later"
    }.`;
  }, [interventions, clearing]);

  return (
    <div className="space-y-3" data-testid="cash-model-liquidity-summary">
      <div className="panel p-4 space-y-3" style={{ border: "1px solid var(--line)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="sec-title">Liquidity Summary</p>
            <p className="treasury-meta text-sm">
              What goes in the client&apos;s monthly report · opening{" "}
              {fmtMoney(openingBalance)} as of {asOf}
            </p>
          </div>
          {onExport ? (
            <button type="button" className="chip" onClick={onExport}>
              Export report
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="treasury-meta-fine">Avg monthly burn</p>
            <p className="font-medium">{fmtMoney(kpis.avgProjectedBurn)}</p>
            {kpis.avgActualNcf != null ? (
              <p className="treasury-meta-fine">
                vs trailing-6 actual {fmtMoney(kpis.avgActualNcf)}
              </p>
            ) : null}
          </div>
          <div>
            <p className="treasury-meta-fine">Lowest projected cash</p>
            <p className="font-medium">
              {kpis.minEnding
                ? `${fmtMoney(kpis.minEnding.value)} · ${monthLabel(kpis.minEnding.month)}`
                : "—"}
            </p>
          </div>
          <div>
            <p className="treasury-meta-fine">First threshold breach</p>
            <p className="font-medium">
              {kpis.noBreach
                ? `none in ${horizon}-mo horizon`
                : kpis.breachMonth
                  ? monthLabel(kpis.breachMonth)
                  : "—"}
            </p>
          </div>
          <div>
            <p className="treasury-meta-fine">Runway</p>
            <p className="font-medium">
              {kpis.runwayMonths != null
                ? `${kpis.runwayMonths} months`
                : runwayStatus?.noBreachInHorizon
                  ? "beyond horizon"
                  : "—"}
            </p>
          </div>
          <div>
            <p className="treasury-meta-fine">Threshold margin at low</p>
            <p className="font-medium">{fmtMoney(kpis.thresholdMargin)}</p>
          </div>
        </div>

        {collectionsLine ? (
          <p className="text-sm" data-testid="collections-improvement-line">
            {collectionsLine}
          </p>
        ) : null}
      </div>

      <CashModelRunwayChart
        asOf={asOf}
        threshold={threshold}
        selectedTimeline={timeline}
        downsideTimeline={downsideTimeline}
        selectedScenarioId={selectedScenarioId}
        selectedSummary={selectedSummary}
      />

      <CashModelExplainChart timeline={timeline} />

      <CashModelCommittedFlowsCard
        clientUserId={clientUserId}
        accountId={accountId}
      />
    </div>
  );
}
