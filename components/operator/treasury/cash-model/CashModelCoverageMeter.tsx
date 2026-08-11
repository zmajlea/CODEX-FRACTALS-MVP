"use client";

import type { CashModelTimelineRow } from "@/lib/treasury/cash-model";
import type { CashModelBucketKey } from "@/lib/treasury/cash-model-types";

type Props = {
  coveragePct: number;
  degradedToTotals: boolean;
  timeline: CashModelTimelineRow[];
};

const DISPLAY_BUCKETS: CashModelBucketKey[] = [
  "uncategorized_in",
  "uncategorized_out",
  "collections",
  "payroll",
  "opex",
];

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Spec 68 Part E — coverage meter air + token fills (no hex). */
export function CashModelCoverageMeter({
  coveragePct,
  degradedToTotals,
  timeline,
}: Props) {
  const pct = Math.round(coveragePct * 100);
  const recent = timeline.filter((r) => r.kind === "actual").slice(-6);
  const uncategorized = recent.reduce(
    (acc, row) => {
      acc.in += row.byBucket.uncategorized_in ?? 0;
      acc.out += Math.abs(row.byBucket.uncategorized_out ?? 0);
      return acc;
    },
    { in: 0, out: 0 }
  );

  const fillClass =
    pct >= 65 ? "cm-cov-fill--hi" : pct >= 35 ? "cm-cov-fill--mid" : "cm-cov-fill--lo";

  return (
    <div className="cm-coverage panel p-4 space-y-3">
      <p className="sec-title">Coverage</p>
      <p className="treasury-meta">
        {pct}% of the last 6 months&apos; flow is categorized
        {degradedToTotals ? " · totals-only mode (low coverage)" : ""}
      </p>
      <div
        className="cm-cov-track"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`cm-cov-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="cm-cov-chips flex flex-wrap gap-2">
        {DISPLAY_BUCKETS.map((b) => {
          const total = recent.reduce(
            (sum, row) => sum + Math.abs(row.byBucket[b] ?? 0),
            0
          );
          if (total <= 0 && !b.startsWith("uncategorized")) return null;
          return (
            <span
              key={b}
              className={`chip ${b.startsWith("uncategorized") ? "prov-assumed" : "prov-pulled"}`}
            >
              {b.replace(/_/g, " ")} · {fmtMoney(total)}
            </span>
          );
        })}
        {(uncategorized.in > 0 || uncategorized.out > 0) && recent.length === 0 ? (
          <span className="chip prov-assumed">Uncategorized visible in explain chart</span>
        ) : null}
      </div>
    </div>
  );
}
