"use client";

import { useEffect, useMemo, useState } from "react";
import { PickButton } from "@/components/operator/treasury/PickButton";
import {
  formatSuMoney,
  formatTreasuryMoney,
  TREASURY_DISPLAY_LOCALE,
} from "@/lib/treasury/format";
import { sumBalancesByCurrency } from "@/lib/treasury/cash-totals";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  TreasuryAccountView,
  TreasuryInstitutionView,
  TreasuryRuleRow,
  TreasuryTransaction,
} from "@/lib/treasury/types";

type TabTarget = "transactions" | "rules" | "recommendations";

type Props = {
  clientUserId: string;
  clientName: string;
  tenantName: string;
  institutions: TreasuryInstitutionView[];
  transactions: TreasuryTransaction[];
  lastSyncedAt: string | null;
  dataThrough: string | null;
  needsLabelCount: number;
  accountCount: number;
  csvOnly: boolean;
  transactionCount: number;
  watchNote?: string | null;
  onTabSwitch: (tab: TabTarget) => void;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  rulesRefreshKey?: number;
};

function asOfIso(lastSyncedAt: string | null, dataThrough: string | null): string {
  const raw = dataThrough ?? lastSyncedAt;
  if (raw && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function formatImportDate(iso: string | null): string {
  if (!iso) return "unknown date";
  const d = iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat(TREASURY_DISPLAY_LOCALE, {
      dateStyle: "medium",
    }).format(new Date(`${d}T12:00:00`));
  } catch {
    return d;
  }
}

function capWord(value: string | null | undefined): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function accountRowLabel(acct: TreasuryAccountView): string {
  const mask = acct.mask ?? "????";
  const type = capWord(acct.type) || "Account";
  const subtype = capWord(acct.subtype);
  return subtype ? `${mask} ${type}, ${subtype}` : `${mask} ${type}`;
}

function allAccounts(institutions: TreasuryInstitutionView[]): TreasuryAccountView[] {
  return institutions.flatMap((inst) => inst.accounts ?? []);
}

function recentTransactions(transactions: TreasuryTransaction[]): TreasuryTransaction[] {
  return [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
}

const NC_GO = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export function TreasuryOverviewTiles({
  clientUserId,
  clientName,
  tenantName,
  institutions,
  transactions,
  lastSyncedAt,
  dataThrough,
  needsLabelCount,
  accountCount,
  csvOnly,
  transactionCount,
  watchNote,
  onTabSwitch,
  onPick,
  rulesRefreshKey = 0,
}: Props) {
  const totals = sumBalancesByCurrency(institutions);
  const importDate = formatImportDate(dataThrough ?? lastSyncedAt);
  const asOfDate = asOfIso(lastSyncedAt, dataThrough);
  const accounts = allAccounts(institutions);
  const recent = recentTransactions(transactions);
  const note = watchNote?.trim();

  const [rulesCount, setRulesCount] = useState(0);
  const [confirmedLines, setConfirmedLines] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules`
      );
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as { rules?: TreasuryRuleRow[] };
      const rules = body.rules ?? [];
      if (cancelled) return;
      setRulesCount(rules.length);
      setConfirmedLines(
        rules.reduce((sum, rule) => sum + (rule.confirmed_count ?? 0), 0)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [clientUserId, rulesRefreshKey]);

  const accountsSub = useMemo(() => {
    const n = accountCount;
    if (csvOnly) {
      return `${n} account${n === 1 ? "" : "s"}, CSV import.`;
    }
    return `${n} linked account${n === 1 ? "" : "s"}.`;
  }, [accountCount, csvOnly]);

  const transactionsSub = csvOnly
    ? `${transactionCount.toLocaleString(TREASURY_DISPLAY_LOCALE)} imported rows.`
    : `${transactionCount.toLocaleString(TREASURY_DISPLAY_LOCALE)} synced rows.`;

  return (
    <>
      {note ? (
        <div className="callout">
          <span className="co-dot" />
          <div className="co-t">
            <b>{note.endsWith(".") ? note : `${note}.`}</b>
          </div>
        </div>
      ) : null}

      <section className="tile-row" aria-label="Record summary">
        {totals.map(([currency, total]) => (
          <div key={currency} className="tile">
            {onPick ? (
              <PickButton
                variant="row"
                buttonClassName="pick"
                ariaLabel="Add cash position to a draft"
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
            ) : null}
            <div className="tile-l">Cash position ({currency})</div>
            <div className="tile-n num">{formatTreasuryMoney(total, currency)}</div>
            <div className="tile-sub">As of last import, {importDate}.</div>
          </div>
        ))}

        <div className="tile">
          <div className="tile-l">Uncategorized</div>
          <div className="tile-n num">
            {needsLabelCount.toLocaleString(TREASURY_DISPLAY_LOCALE)}
          </div>
          <div className="tile-sub">
            Not yet categorized or ruled. Normal right after an import.
          </div>
          <button
            type="button"
            className="tile-act"
            onClick={() => onTabSwitch("transactions")}
          >
            Review in Transactions
          </button>
        </div>

        <div className="tile">
          <div className="tile-l">Accounts</div>
          <div className="tile-n num">
            {accountCount.toLocaleString(TREASURY_DISPLAY_LOCALE)}
          </div>
          <div className="tile-sub">{accountsSub}</div>
        </div>

        <div className="tile">
          <div className="tile-l">Transactions</div>
          <div className="tile-n num">
            {transactionCount.toLocaleString(TREASURY_DISPLAY_LOCALE)}
          </div>
          <div className="tile-sub">{transactionsSub}</div>
        </div>
      </section>

      <div className="rec-sec">
        <h2 className="rs-h">Work this record</h2>
        <p className="rs-note">
          The three places you do the work: categorize the ledger, turn a
          categorization into a rule, and send sealed guidance.
        </p>
      </div>

      <div className="navgrid">
        <button
          type="button"
          className="navcard"
          onClick={() => onTabSwitch("transactions")}
        >
          <span className="nc-ic">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 4v16M7 20h10M5 8h14M9 8l-3 5.5a2.6 2.6 0 0 0 6 0L9 8Zm6 0-3 5.5a2.6 2.6 0 0 0 6 0L15 8Z" />
            </svg>
          </span>
          <span className="nc-b">
            <span className="nc-t">Transactions</span>
            <span className="nc-s">
              {needsLabelCount.toLocaleString(TREASURY_DISPLAY_LOCALE)} to review,{" "}
              {transactionCount.toLocaleString(TREASURY_DISPLAY_LOCALE)} in all
            </span>
          </span>
          <span className="nc-go">{NC_GO}</span>
        </button>

        <button
          type="button"
          className="navcard"
          onClick={() => onTabSwitch("rules")}
        >
          <span className="nc-ic">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 13 11 6a2 2 0 0 1 1.4-.6H18a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4l-7 7a1.5 1.5 0 0 1-2.1 0l-6.3-6.3a1.5 1.5 0 0 1 0-2.1Z" />
              <circle cx="15.5" cy="8.5" r="1.2" />
            </svg>
          </span>
          <span className="nc-b">
            <span className="nc-t">Rules</span>
            <span className="nc-s">
              {rulesCount} rules, {confirmedLines.toLocaleString(TREASURY_DISPLAY_LOCALE)}{" "}
              lines confirmed
            </span>
          </span>
          <span className="nc-go">{NC_GO}</span>
        </button>

        <button
          type="button"
          className="navcard"
          onClick={() => onTabSwitch("recommendations")}
        >
          <span className="nc-ic">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14.5 5.5l4 4M4 20l1-4L16 5a1.5 1.5 0 0 1 3 3L8 19l-4 1Z" />
            </svg>
          </span>
          <span className="nc-b">
            <span className="nc-t">Recommendations</span>
            <span className="nc-s">Sealed advice and questions sent</span>
          </span>
          <span className="nc-go">{NC_GO}</span>
        </button>
      </div>

      <div className="rec-sec">
        <h2 className="rs-h">{clientName}&apos;s accounts</h2>
        <p className="rs-note">
          Managed under {tenantName}. Category is editable here; suspend and revoke
          live on Profile.
        </p>
      </div>
      <div className="acct-list">
        {accounts.map((acct) => (
          <div key={acct.account_id} className="acct-row">
            <span>{accountRowLabel(acct)}</span>
            <span className="amt num">
              {formatTreasuryMoney(
                acct.current_balance,
                acct.iso_currency_code ?? "USD"
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="rec-sec">
        <h2 className="rs-h">Recent activity</h2>
        <p className="rs-note">
          The 5 most recent transactions. Money in is green with a plus; money out
          is red with a minus.
        </p>
      </div>
      <div className="act-list">
        {recent.map((tx, index) => {
          const amtClass =
            tx.direction === "in"
              ? "amt in num"
              : tx.direction === "out"
                ? "amt out num"
                : "amt num";
          return (
            <div key={`${tx.account_id}-${tx.date}-${index}`} className="act-row">
              <div className="ar-desc">
                <div className="ar-t">{tx.name}</div>
                <div className="ar-d">{formatImportDate(tx.date)}</div>
              </div>
              <span className={amtClass}>
                {formatSuMoney(tx.amount, tx.direction)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
