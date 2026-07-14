"use client";

import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import { sumBalancesByCurrency } from "@/lib/treasury/cash-totals";
import type { TreasuryInstitutionView } from "@/lib/treasury/types";

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  needsLabelCount?: number;
  onNeedsReviewClick?: () => void;
  sourceCount?: number;
  transactionCount?: number;
  showMetaTiles?: boolean;
};

export function TreasuryOverviewTiles({
  institutions,
  lastSyncedAt,
  needsLabelCount,
  onNeedsReviewClick,
  sourceCount,
  transactionCount,
  showMetaTiles = true,
}: Props) {
  const totals = sumBalancesByCurrency(institutions);
  const asOf = formatTreasuryAsOf(lastSyncedAt);
  const showNeedsReview = needsLabelCount !== undefined && onNeedsReviewClick;

  if (totals.length === 0 && !showNeedsReview && !showMetaTiles) return null;

  return (
    <div className="dash-tiles">
      {totals.map(([currency, total]) => (
        <div key={currency} className="dtile">
          <span className="dt-k">Cash position ({currency})</span>
          <span className="dt-v tabular-nums">{formatTreasuryMoney(total, currency)}</span>
          <span className="dt-s">as of {asOf}</span>
        </div>
      ))}

      {showNeedsReview ? (
        <button
          type="button"
          className={`dtile text-left ${needsLabelCount! > 0 ? "warn" : "ok"}`}
          onClick={onNeedsReviewClick}
        >
          <span className="dt-k">Needs review</span>
          <span className="dt-v">{needsLabelCount}</span>
          <span className="dt-s">
            {needsLabelCount! > 0 ? "flagged lines" : "all clear"}
          </span>
        </button>
      ) : null}

      {showMetaTiles && sourceCount !== undefined ? (
        <div className="dtile">
          <span className="dt-k">Sources</span>
          <span className="dt-v">{sourceCount}</span>
          <span className="dt-s">linked institutions</span>
        </div>
      ) : null}

      {showMetaTiles && transactionCount !== undefined ? (
        <div className="dtile">
          <span className="dt-k">Transactions</span>
          <span className="dt-v">{transactionCount}</span>
          <span className="dt-s">synced rows</span>
        </div>
      ) : null}
    </div>
  );
}
