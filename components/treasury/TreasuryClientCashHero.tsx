"use client";

import { useMemo } from "react";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import { sumBalancesByCurrency } from "@/lib/treasury/cash-totals";
import type { TreasuryInstitutionView } from "@/lib/treasury/types";

type AccountRow = {
  account_id: string;
  name: string;
  mask: string | null;
  institution: string;
  isCsv: boolean;
  balance: number;
  currency: string;
  type: string | null;
  subtype: string | null;
};

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  loading?: boolean;
};

function accountSourceLabel(isCsv: boolean): string {
  return isCsv ? "Imported (CSV)" : "Bank feed";
}

export function TreasuryClientCashHero({
  institutions,
  lastSyncedAt,
  loading = false,
}: Props) {
  const totals = useMemo(() => sumBalancesByCurrency(institutions), [institutions]);

  const accounts = useMemo((): AccountRow[] => {
    const rows: AccountRow[] = [];
    for (const inst of institutions) {
      const isCsv = inst.item_id === "csv-manual";
      for (const acct of inst.accounts) {
        rows.push({
          account_id: acct.account_id,
          name: acct.name ?? "Account",
          mask: acct.mask,
          institution: inst.institution_name ?? "Linked",
          isCsv,
          balance: acct.current_balance ?? 0,
          currency: acct.iso_currency_code ?? "USD",
          type: acct.type ?? null,
          subtype: acct.subtype ?? null,
        });
      }
    }
    return rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [institutions]);

  const primary = totals.length
    ? [...totals].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]!
    : null;
  const primaryCurrency = primary?.[0] ?? "USD";
  const primaryTotal = primary?.[1] ?? 0;

  const asOfLabel = lastSyncedAt
    ? formatTreasuryAsOf(lastSyncedAt)
    : "your last import";

  if (loading && accounts.length === 0) {
    return (
      <section className="cash-hero" aria-label="Cash position">
        <div className="ch-l">Cash position</div>
        <p className="meta">Loading…</p>
      </section>
    );
  }

  return (
    <section className="cash-hero" aria-label="Cash position">
      <div className="ch-l">Cash position</div>
      <div className="ch-n num">
        {formatTreasuryMoney(primaryTotal, primaryCurrency)} {primaryCurrency}
      </div>
      <div className="meta">As of {asOfLabel}.</div>
      {accounts.map((acct) => {
        const label = acct.mask
          ? `${acct.name} · ····${acct.mask}`
          : acct.name;
        const meta = [acct.type, acct.subtype].filter(Boolean).join(", ");
        return (
          <div key={acct.account_id} className="acct-bar">
            <span>
              {label}
              {meta ? ` ${meta}` : ""}{" "}
              <span className="ab-src">{accountSourceLabel(acct.isCsv)}</span>
            </span>
            <span className="amt num">
              {formatTreasuryMoney(acct.balance, acct.currency)}
            </span>
          </div>
        );
      })}
    </section>
  );
}
