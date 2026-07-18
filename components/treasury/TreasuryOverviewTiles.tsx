"use client";

import { PickButton } from "@/components/operator/treasury/PickButton";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import { sumBalancesByCurrency } from "@/lib/treasury/cash-totals";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { TreasuryInstitutionView } from "@/lib/treasury/types";

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  needsLabelCount?: number;
  onNeedsReviewClick?: () => void;
  sourceCount?: number;
  /** Spec 35-5 — prefer account count when CSV has no real institution. */
  accountCount?: number;
  csvOnly?: boolean;
  transactionCount?: number;
  showMetaTiles?: boolean;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

function asOfIso(lastSyncedAt: string | null): string {
  if (lastSyncedAt && /^\d{4}-\d{2}-\d{2}/.test(lastSyncedAt)) {
    return lastSyncedAt.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

export function TreasuryOverviewTiles({
  institutions,
  lastSyncedAt,
  needsLabelCount,
  onNeedsReviewClick,
  sourceCount,
  accountCount,
  csvOnly = false,
  transactionCount,
  showMetaTiles = true,
  onPick,
}: Props) {
  const totals = sumBalancesByCurrency(institutions);
  const asOf = formatTreasuryAsOf(lastSyncedAt);
  const asOfDate = asOfIso(lastSyncedAt);
  const showNeedsReview = needsLabelCount !== undefined && onNeedsReviewClick;

  if (totals.length === 0 && !showNeedsReview && !showMetaTiles) return null;

  const sourcesLabel = csvOnly
    ? `${accountCount ?? 0} account${(accountCount ?? 0) === 1 ? "" : "s"} · CSV import`
    : "linked institutions";
  const sourcesValue = csvOnly
    ? (accountCount ?? 0)
    : (sourceCount ?? institutions.length);

  return (
    <div className="dash-tiles">
      {totals.map(([currency, total]) => (
        <div key={currency} className="dtile relative">
          <span className="dt-k">Cash position ({currency})</span>
          <span className="dt-v tabular-nums">{formatTreasuryMoney(total, currency)}</span>
          <span className="dt-s">as of {asOf}</span>
          {onPick ? (
            <span className="absolute top-2 right-2">
              <PickButton
                variant="row"
                pickable={{
                  kind: "figure",
                  params: {
                    metric: "cash_position",
                    from: asOfDate,
                    to: asOfDate,
                  },
                  label: `Cash position (${currency})`,
                  sublabel: formatTreasuryMoney(total, currency),
                }}
                onPick={onPick}
              />
            </span>
          ) : null}
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

      {showMetaTiles && (sourceCount !== undefined || csvOnly) ? (
        <div className="dtile">
          <span className="dt-k">{csvOnly ? "Accounts" : "Sources"}</span>
          <span className="dt-v">{sourcesValue}</span>
          <span className="dt-s">{sourcesLabel}</span>
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
