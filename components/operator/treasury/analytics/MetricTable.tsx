"use client";

import type { MetricComparison } from "@/lib/treasury/metrics-eval";

type SeriesPoint = {
  bucket_start?: string;
  bucket_label: string;
  value: number;
  partial?: true;
  breaches?: string[];
};

type RefLine = { id: string; label: string; value: number; kind?: string };

function fmtMoney(v: number): string {
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Spec B15 — v:2 series as rows. */
export function MetricSeriesTable({
  points,
  referenceLines,
}: {
  points: SeriesPoint[];
  referenceLines?: RefLine[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-[var(--su-line,#DED9D1)]">
            <th className="py-1.5 pr-3 font-medium">Period</th>
            <th className="py-1.5 font-medium text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr
              key={p.bucket_start ?? p.bucket_label}
              className="border-b border-[var(--su-line,#DED9D1)]/60"
            >
              <td className="py-1.5 pr-3">
                {p.bucket_label}
                {p.partial ? (
                  <span className="ml-1 text-xs opacity-60">partial</span>
                ) : null}
                {p.breaches?.length ? (
                  <span className="ml-1 text-xs text-[var(--su-warn,#E67E50)]">
                    breach
                  </span>
                ) : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(p.value)}</td>
            </tr>
          ))}
        </tbody>
        {referenceLines?.length ? (
          <tfoot>
            {referenceLines.map((r) => (
              <tr key={r.id} className="opacity-70">
                <td className="py-1.5 pr-3 text-xs">{r.label}</td>
                <td className="py-1.5 text-right text-xs tabular-nums">
                  {fmtMoney(r.value)}
                </td>
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Spec B15 — v:3 comparison as axis × groups matrix. */
export function MetricComparisonTable({
  comparison,
}: {
  comparison: MetricComparison;
}) {
  const labels = comparison.axis.labels;
  const groups = comparison.groups;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-[var(--su-line,#DED9D1)]">
            <th className="py-1.5 pr-3 font-medium">Period</th>
            {groups.map((g) => (
              <th key={g.key} className="py-1.5 px-2 font-medium text-right">
                {g.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, idx) => (
            <tr
              key={label}
              className="border-b border-[var(--su-line,#DED9D1)]/60"
            >
              <td className="py-1.5 pr-3">{label}</td>
              {groups.map((g) => {
                const pt = g.points[idx];
                return (
                  <td
                    key={g.key}
                    className="py-1.5 px-2 text-right tabular-nums"
                  >
                    {pt ? fmtMoney(pt.value) : "—"}
                    {pt?.partial ? (
                      <span className="ml-1 text-xs opacity-60">·</span>
                    ) : null}
                    {pt?.breaches?.length ? (
                      <span className="ml-1 text-xs text-[var(--su-warn,#E67E50)]">
                        !
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {comparison.reference_lines?.length ? (
          <tfoot>
            {comparison.reference_lines.map((r) => (
              <tr key={r.id} className="opacity-70">
                <td className="py-1.5 pr-3 text-xs" colSpan={groups.length + 1}>
                  {r.label}: {fmtMoney(r.value)}
                </td>
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
