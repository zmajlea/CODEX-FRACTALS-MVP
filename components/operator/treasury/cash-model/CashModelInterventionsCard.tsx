"use client";

import type { CashModelIntervention } from "@/lib/treasury/cash-model-interventions";

type Props = {
  interventions: CashModelIntervention[];
  hasBreach: boolean;
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function CashModelInterventionsCard({ interventions, hasBreach }: Props) {
  const clearing = interventions.filter((i) => i.clearsBreach);
  const top = interventions.slice(0, 5);

  if (!hasBreach && clearing.length === 0) {
    return (
      <div className="panel p-4 space-y-2" style={{ border: "1px solid var(--line)" }}>
        <p className="sec-title">Interventions</p>
        <p className="treasury-meta">
          No floor breach under the selected scenario — interventions not required.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-3" style={{ border: "1px solid var(--line)" }}>
      <p className="sec-title">Interventions</p>
      <p className="treasury-meta">
        Computed proposals only — not applied to the model or ledger.
      </p>
      {clearing.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Smallest moves that clear the floor</p>
          <ul className="space-y-2 text-sm">
            {clearing.slice(0, 3).map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <span className="chip prov-pulled">{i.label}</span>{" "}
                  <span className="treasury-meta">{i.description}</span>
                </span>
                <span className="num treasury-meta">
                  {fmtMoney(i.horizonBenefit)} / horizon
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="treasury-meta">No single template clears the floor — see partial moves below.</p>
      )}
      {top.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="treasury-meta text-left">
                <th className="py-1 pr-2">Proposal</th>
                <th className="py-1 pr-2">Effect</th>
                <th className="py-1 text-right">Horizon Δ</th>
              </tr>
            </thead>
            <tbody>
              {top.map((i) => (
                <tr key={i.id} className="border-t border-[var(--line)]">
                  <td className="py-2 pr-2">{i.label}</td>
                  <td className="py-2 pr-2 treasury-meta">{i.description}</td>
                  <td className="py-2 text-right num">{fmtMoney(i.horizonBenefit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
