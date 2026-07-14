"use client";

import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { ContributorLine, PeriodDecomposition } from "@/lib/treasury/period-decomposition";

type Props = {
  decomposition: PeriodDecomposition;
  contributors: ContributorLine[];
  currency: string;
  netLabel?: string;
  closing?: number | null;
};

export function TreasuryCashflowDecomposition({
  decomposition,
  contributors,
  currency,
  netLabel = "Net for the period",
  closing = null,
}: Props) {
  const { receipts, disbursements, recTotal, disbTotal, net } = decomposition;
  const maxContrib = Math.max(1, ...contributors.map((c) => c.amount));

  return (
    <>
      <div className="cf-body">
        <div className="cf-col">
          <div className="cf-colh">
            Receipts <b>+{formatTreasuryMoney(recTotal, currency)}</b>
          </div>
          {receipts.length === 0 ? (
            <p className="text-sm text-codex-muted">No inflows</p>
          ) : (
            receipts.map((line) => (
              <div key={`rec-${line.name}`} className="cf-line">
                <span className="cf-ln">{line.name}</span>
                <span className="cf-lv in">+{formatTreasuryMoney(line.amount, currency)}</span>
              </div>
            ))
          )}
        </div>
        <div className="cf-col">
          <div className="cf-colh">
            Disbursements <b>−{formatTreasuryMoney(disbTotal, currency)}</b>
          </div>
          {disbursements.length === 0 ? (
            <p className="text-sm text-codex-muted">No outflows</p>
          ) : (
            disbursements.map((line) => (
              <div key={`disb-${line.name}`} className="cf-line">
                <span className="cf-ln">{line.name}</span>
                <span className="cf-lv out">−{formatTreasuryMoney(line.amount, currency)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="cf-net">
        <span>{netLabel}</span>
        <b className={net >= 0 ? "in" : "out"}>
          {net >= 0 ? "+" : "−"}
          {formatTreasuryMoney(Math.abs(net), currency)}
        </b>
        {closing != null ? (
          <span className="cf-net-x">
            · closing{" "}
            <b>
              {closing >= 0 ? "" : "−"}
              {formatTreasuryMoney(Math.abs(closing), currency)}
            </b>
          </span>
        ) : null}
      </div>

      {contributors.length > 0 ? (
        <div className="cf-contrib">
          <div className="cf-colh">Largest contributors</div>
          {contributors.map((c) => (
            <div key={`${c.direction}-${c.name}`} className="cfc-row">
              <span className="cfc-n">{c.name}</span>
              <span className="cfc-bar">
                <span
                  className={`cfc-fill ${c.direction === "in" ? "in" : "out"}`}
                  style={{ width: `${Math.round((c.amount / maxContrib) * 100)}%` }}
                />
              </span>
              <span className={`cfc-v ${c.direction === "in" ? "in" : "out"}`}>
                {c.direction === "in" ? "+" : "−"}
                {formatTreasuryMoney(c.amount, currency)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="cf-recon">Reconciles: receipts − disbursements = net.</p>
    </>
  );
}
