"use client";

import { useMemo } from "react";
import { TreasuryCashflowDecomposition } from "@/components/operator/treasury/TreasuryCashflowDecomposition";
import { periodLabel } from "@/lib/treasury/period-bounds";
import {
  aggregateByLabel,
  contributorsFromLines,
  topContributors,
} from "@/lib/treasury/period-decomposition";
import type { SummaryGranularity, TreasuryForecastPeriod } from "@/lib/treasury/types";

type Props = {
  open: boolean;
  granularity: SummaryGranularity;
  period: TreasuryForecastPeriod;
  currency: string;
  onClose: () => void;
};

export function TreasuryForecastDrillModal({
  open,
  granularity,
  period,
  currency,
  onClose,
}: Props) {
  const decomposition = useMemo(() => {
    const receipts: { name: string; amount: number }[] = [];
    const disbursements: { name: string; amount: number }[] = [];

    for (const line of period.recurring) {
      const entry = { name: line.merchant, amount: line.amount };
      if (line.direction === "in") receipts.push(entry);
      else disbursements.push(entry);
    }
    if (period.baseline_inflow > 0) {
      receipts.push({ name: "Other inflows (median)", amount: period.baseline_inflow });
    }
    if (period.baseline_outflow > 0) {
      disbursements.push({ name: "Other outflows (median)", amount: period.baseline_outflow });
    }

    receipts.sort((a, b) => b.amount - a.amount);
    disbursements.sort((a, b) => b.amount - a.amount);

    return {
      receipts,
      disbursements,
      recTotal: period.projected_receipts,
      disbTotal: period.projected_disbursements,
      net: period.net,
    };
  }, [period]);

  const contributors = useMemo(() => {
    const lines = [
      ...period.recurring.map((line) => ({
        name: line.merchant,
        amount: line.amount,
        direction: line.direction,
      })),
      ...(period.baseline_inflow > 0
        ? [{ name: "Other inflows (median)", amount: period.baseline_inflow, direction: "in" as const }]
        : []),
      ...(period.baseline_outflow > 0
        ? [{ name: "Other outflows (median)", amount: period.baseline_outflow, direction: "out" as const }]
        : []),
    ];
    return contributorsFromLines(lines, 5);
  }, [period]);

  if (!open) return null;

  const label = periodLabel(granularity, period.period_start);

  return (
    <div
      className="tx-drill-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tx-drill-modal" role="dialog" aria-modal="true" aria-labelledby="fc-drill-title">
        <header className="tx-drill-head">
          <div>
            <p className="text-xs uppercase tracking-wide text-codex-muted">Projected period</p>
            <h2 id="fc-drill-title" className="font-head text-lg">
              {label}
            </h2>
          </div>
          <button type="button" className="btn btn-secondary text-xs" onClick={onClose}>
            Close
          </button>
        </header>

        <TreasuryCashflowDecomposition
          decomposition={decomposition}
          contributors={contributors}
          currency={currency}
          netLabel="Net for the period"
          closing={period.closing}
        />
      </div>
    </div>
  );
}
