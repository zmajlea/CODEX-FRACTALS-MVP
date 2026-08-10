"use client";

import type { CashModelBacktestRow } from "@/lib/treasury/cash-model-backtest";

type Props = {
  rows: CashModelBacktestRow[];
};

function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function CashModelBacktestSection({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="panel p-4 space-y-2" style={{ border: "1px solid var(--line)" }}>
        <p className="sec-title">Backtest</p>
        <p className="treasury-meta">Not enough history for predicted-vs-actual breach comparison.</p>
      </div>
    );
  }

  const matches = rows.filter((r) => r.match).length;

  return (
    <div className="panel p-4 space-y-2" style={{ border: "1px solid var(--line)" }}>
      <p className="sec-title">Backtest</p>
      <p className="treasury-meta">
        Had we run this model as of each month — predicted breach vs what actually happened (
        {matches}/{rows.length} match on breach month).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="treasury-meta text-left">
              <th className="py-1 pr-2">As-of</th>
              <th className="py-1 pr-2">Predicted breach</th>
              <th className="py-1 pr-2">Actual breach</th>
              <th className="py-1 pr-2 text-right">Low after</th>
              <th className="py-1 text-right">Match</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.asOfMonth} className="border-t border-[var(--line)]">
                <td className="py-1 pr-2">{monthLabel(r.asOfMonth)}</td>
                <td className="py-1 pr-2">
                  {r.predictedBreachMonth ? monthLabel(r.predictedBreachMonth) : "—"}
                </td>
                <td className="py-1 pr-2">
                  {r.actualBreachMonth ? monthLabel(r.actualBreachMonth) : "—"}
                </td>
                <td className="py-1 pr-2 text-right num">
                  ${Math.round(r.actualLowEnding).toLocaleString()}
                </td>
                <td className="py-1 text-right">{r.match ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
