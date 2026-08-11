"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CashModelCoverageMeter } from "@/components/operator/treasury/cash-model/CashModelCoverageMeter";
import { CashModelExplainChart } from "@/components/operator/treasury/cash-model/CashModelExplainChart";
import type { CashModelTimelineRow } from "@/lib/treasury/cash-model";
import {
  CASH_MODEL_BUCKET_KEYS,
  type CashModelBucketKey,
} from "@/lib/treasury/cash-model-types";

type Props = {
  clientUserId: string;
  accountId: string;
  coveragePct: number;
  degradedToTotals: boolean;
  timeline: CashModelTimelineRow[];
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function monthShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * Spec 65-R Block 2 / Spec 68 Part E — Where the money goes (air + tokens).
 */
export function CashModelCategoryDivisionCard({
  clientUserId,
  accountId,
  coveragePct,
  degradedToTotals,
  timeline,
}: Props) {
  const router = useRouter();

  const actuals = useMemo(
    () => timeline.filter((r) => r.kind === "actual").slice(-6),
    [timeline]
  );
  const projected = useMemo(
    () => timeline.filter((r) => r.kind === "projected").slice(0, 1),
    [timeline]
  );
  const cols = useMemo(() => [...actuals, ...projected], [actuals, projected]);

  const uncategorizedStats = useMemo(() => {
    let amount = 0;
    for (const row of actuals) {
      amount += Math.abs(row.byBucket.uncategorized_in ?? 0);
      amount += Math.abs(row.byBucket.uncategorized_out ?? 0);
    }
    const monthCount = actuals.length;
    return { amount, monthCount };
  }, [actuals]);

  const showRulesCta = uncategorizedStats.amount > 0 && coveragePct < 0.95;

  function goToRules() {
    const qs = new URLSearchParams({ tab: "rules" });
    if (accountId) qs.set("account", accountId);
    router.push(`/operator/treasury/clients/${clientUserId}?${qs.toString()}`);
  }

  return (
    <div className="cm-division space-y-3">
      <div className="cm-division-intro panel p-3 space-y-2">
        <p className="sec-title">Where the money goes</p>
        <p className="treasury-meta text-sm">
          Last six actual months by Tim bucket, plus the next projected month.
          Uncategorized stays visible.
        </p>
      </div>

      <CashModelCoverageMeter
        coveragePct={coveragePct}
        degradedToTotals={degradedToTotals}
        timeline={timeline}
      />

      <CashModelExplainChart timeline={timeline} />

      {showRulesCta ? (
        <div className="cm-rules-cta panel p-3 space-y-2" data-testid="cash-model-rules-cta">
          <p className="text-sm font-medium">
            {fmtMoney(uncategorizedStats.amount)} across the last{" "}
            {uncategorizedStats.monthCount} months is uncategorized — create
            rules to sharpen this division
          </p>
          <button type="button" className="chip" onClick={goToRules}>
            Open Rules
          </button>
        </div>
      ) : null}

      <div className="cm-bucket-table panel p-3 overflow-x-auto">
        <p className="sec-title mb-2">Monthly by bucket</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="treasury-meta text-left">
              <th className="py-1 pr-2">Bucket</th>
              {cols.map((c) => (
                <th key={`${c.month}-${c.kind}`} className="py-1 pr-2 text-right">
                  {monthShort(c.month)}
                  {c.kind === "projected" ? (
                    <span className="chip prov-assumed ml-1 text-xs">proj</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CASH_MODEL_BUCKET_KEYS.map((bucket: CashModelBucketKey) => {
              const hasAny = cols.some((c) => Math.abs(c.byBucket[bucket] ?? 0) > 0.5);
              if (!hasAny && !bucket.startsWith("uncategorized")) return null;
              return (
                <tr key={bucket} className="border-t border-[var(--line)]">
                  <td className="py-1 pr-2">
                    {bucket.replace(/_/g, " ")}
                    {bucket.startsWith("uncategorized") ? (
                      <span className="chip prov-assumed ml-1 text-xs">uncat</span>
                    ) : null}
                  </td>
                  {cols.map((c) => {
                    const v = c.byBucket[bucket] ?? 0;
                    return (
                      <td
                        key={`${bucket}-${c.month}`}
                        className={`py-1 pr-2 text-right${
                          c.kind === "projected" ? " chip-cell" : ""
                        }`}
                      >
                        {c.kind === "projected" ? (
                          <span className="chip prov-assumed">{fmtMoney(v)}</span>
                        ) : (
                          fmtMoney(v)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
