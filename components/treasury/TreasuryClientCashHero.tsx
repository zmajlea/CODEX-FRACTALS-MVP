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
  balance: number;
  currency: string;
};

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
};

function currencySymbol(code: string): string {
  if (code === "EUR") return "€";
  if (code === "USD") return "$";
  return code;
}

export function TreasuryClientCashHero({ institutions, lastSyncedAt }: Props) {
  const totals = useMemo(() => sumBalancesByCurrency(institutions), [institutions]);

  const accounts = useMemo((): AccountRow[] => {
    const rows: AccountRow[] = [];
    for (const inst of institutions) {
      for (const acct of inst.accounts) {
        rows.push({
          account_id: acct.account_id,
          name: acct.name ?? "Account",
          mask: acct.mask,
          institution: inst.institution_name ?? "Linked",
          balance: acct.current_balance ?? 0,
          currency: acct.iso_currency_code ?? "USD",
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
  const secondary = totals.filter(([c]) => c !== primaryCurrency);

  const maxByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const acct of accounts) {
      const abs = Math.abs(acct.balance);
      map.set(acct.currency, Math.max(map.get(acct.currency) ?? 0, abs));
    }
    return map;
  }, [accounts]);

  const accountCount = accounts.length;
  const institutionCount = institutions.length;
  const asOfLabel = lastSyncedAt
    ? formatTreasuryAsOf(lastSyncedAt)
    : "From your imported book";

  return (
    <section className="ct-hero treasury-section" aria-label="Cash position">
      <p className="eyebrow">Cash position</p>
      <div className="ct-hero-grid">
        <div>
          <div>
            <span className="ct-hero-primary">{formatTreasuryMoney(primaryTotal, primaryCurrency)}</span>
            <span className="ct-currency-chip">{primaryCurrency}</span>
          </div>
          {secondary.map(([cur, amt]) => (
            <div key={cur}>
              <p className="ct-hero-secondary">
                + {currencySymbol(cur)}
                {Math.abs(amt).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}{" "}
                held in {cur}
              </p>
              <p className="ct-hero-fine">Currencies are not converted or combined.</p>
            </div>
          ))}
        </div>
        <div>
          {accounts.map((acct) => {
            const max = maxByCurrency.get(acct.currency) ?? 1;
            const pct = Math.max(4, (Math.abs(acct.balance) / max) * 100);
            const isLead = Math.abs(acct.balance) === max;
            return (
              <div key={acct.account_id} className="ct-acct-row">
                <div>
                  <div className="ct-acct-name">
                    {acct.name}
                    {acct.mask ? ` · ····${acct.mask}` : ""}
                  </div>
                  <div className="ct-acct-sub">{acct.institution}</div>
                </div>
                <div className="ct-acct-bal">{formatTreasuryMoney(acct.balance, acct.currency)}</div>
                <div className="ct-acct-bar">
                  <span
                    className={`ct-acct-bar-fill ${isLead ? "lead" : "rest"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="ct-hero-foot">
        As of {asOfLabel} · {accountCount} book account{accountCount === 1 ? "" : "s"} + {institutionCount}{" "}
        institution{institutionCount === 1 ? "" : "s"}
      </p>
    </section>
  );
}
