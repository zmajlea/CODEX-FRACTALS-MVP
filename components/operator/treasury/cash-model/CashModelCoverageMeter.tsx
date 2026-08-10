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

  return (
    <div className="panel p-4 space-y-3" style={{ border: "1px solid var(--line)" }}>
      <p className="sec-title">Coverage</p>
      <p className="treasury-meta">
        {pct}% of the last 6 months&apos; flow is categorized
        {degradedToTotals ? " · totals-only mode (low coverage)" : ""}
      </p>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "var(--line)" }}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background:
              pct >= 65
                ? "color-mix(in srgb, var(--brand-2) 80%, var(--paper))"
                : pct >= 35
                  ? "color-mix(in srgb, var(--pulse-amber,#EBC06D) 85%, var(--paper))"
                  : "color-mix(in srgb, var(--su-neg) 80%, var(--paper))",
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
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
