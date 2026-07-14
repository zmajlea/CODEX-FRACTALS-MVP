"use client";

import type {
  TreasuryInstitutionView,
  TreasuryTransaction,
} from "@/lib/treasury/types";
import { PlaidLinkButton } from "@/components/treasury/PlaidLinkButton";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import { sumBalancesByCurrency } from "@/lib/treasury/cash-totals";

function TotalsByCurrency({ institutions }: { institutions: TreasuryInstitutionView[] }) {
  const totals = sumBalancesByCurrency(institutions);

  if (totals.length === 0) return null;

  return (
    <div className="treasury-totals">
      {totals.map(([currency, total]) => (
        <div key={currency} className="treasury-total-card">
          <span className="treasury-total-label">Total balance ({currency})</span>
          <span className="treasury-total-value tabular-nums">
            {formatTreasuryMoney(total, currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

export type TreasuryAccountsViewProps = {
  institutions: TreasuryInstitutionView[];
  transactions: TreasuryTransaction[];
  loading?: boolean;
  error?: string | null;
  readOnly?: boolean;
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  showConnectButton?: boolean;
  hideTotals?: boolean;
  transactionCount?: number;
  onRefresh?: () => void;
  onLinked?: () => void;
  headerExtra?: React.ReactNode;
};

function amountClass(tx: TreasuryTransaction): string {
  if (tx.direction === "in") return "tx-drill-amt in";
  if (tx.direction === "out") return "tx-drill-amt out";
  return "tx-drill-amt";
}

export function TreasuryAccountsView({
  institutions,
  transactions,
  loading = false,
  error = null,
  readOnly = false,
  embedded = false,
  title = "Your accounts",
  subtitle = "Read-only balances and recent transactions from linked banks.",
  showConnectButton = true,
  hideTotals = false,
  transactionCount,
  onRefresh,
  onLinked,
  headerExtra,
}: TreasuryAccountsViewProps) {
  const hasItems = institutions.length > 0;
  const recent = transactions.slice(0, 10);
  const totalCount = transactionCount ?? transactions.length;

  const loadingBlock = (
    <p className="treasury-muted">Loading accounts…</p>
  );

  const errorBlock = (
    <>
      <p className="panel-note" style={{ color: "var(--su-neg)" }} role="alert">
        {error}
      </p>
      {onRefresh ? (
        <button type="button" className="btn btn-secondary mt-4" onClick={onRefresh}>
          Try again
        </button>
      ) : null}
    </>
  );

  if (loading && institutions.length === 0 && !error) {
    return embedded ? loadingBlock : <div className="treasury-page p-8">{loadingBlock}</div>;
  }

  if (error && institutions.length === 0) {
    return embedded ? errorBlock : <div className="treasury-page p-8">{errorBlock}</div>;
  }

  const connectBar = !readOnly && showConnectButton ? (
    <div className="flex flex-wrap gap-3 mb-8">
      <PlaidLinkButton
        label={hasItems ? "Connect another bank" : "Connect your first bank"}
        onLinked={onLinked}
      />
      {hasItems && onRefresh ? (
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={onRefresh}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      ) : null}
    </div>
  ) : readOnly && onRefresh ? (
    <div className="flex flex-wrap gap-3 mb-8">
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={onRefresh}>
        {loading ? "Refreshing…" : "Refresh from bank"}
      </button>
    </div>
  ) : null;

  const accountsBody = hasItems ? (
    <>
      {!embedded && !hideTotals ? <TotalsByCurrency institutions={institutions} /> : null}

      {embedded ? (
        <section className="treasury-section" aria-label="Accounts">
          <h2 className="sec-title">Accounts</h2>
          {institutions.map((inst) => (
            <div key={inst.item_id} className="ct-inst-panel">
              <div className="ct-inst-head">
                <h3 className="ct-inst-name">{inst.institution_name ?? "Linked institution"}</h3>
                {inst.key_destroyed || inst.needs_reconnect ? (
                  <span className="ct-status-neg">Reconnect required</span>
                ) : null}
              </div>
              {inst.accounts.map((acct) => (
                <div key={acct.account_id} className="ct-acct-line">
                  <div>
                    <span className="ct-acct-line-name">
                      {acct.name ?? "Account"}
                      {acct.mask ? ` · ····${acct.mask}` : ""}
                    </span>
                    <span className="ct-acct-line-type capitalize">
                      {[acct.type, acct.subtype].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <span className="ct-acct-line-bal">
                    {formatTreasuryMoney(acct.current_balance, acct.iso_currency_code)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : (
        <div className="space-y-6 mt-8">
          {institutions.map((inst) => (
            <section key={inst.item_id} className="treasury-institution panel">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="sec-title" style={{ margin: 0, fontSize: "18px" }}>
                  {inst.institution_name ?? "Linked institution"}
                </h2>
                {inst.key_destroyed || inst.needs_reconnect ? (
                  <span className="ct-status-neg">Reconnect required</span>
                ) : null}
              </div>
              {inst.key_destroyed ? (
                <p className="treasury-muted mb-4">
                  Encryption key unavailable. The client must re-link their bank.
                </p>
              ) : inst.needs_reconnect ? (
                <p className="treasury-muted mb-4">
                  This connection needs to be refreshed. Ask the client to re-link.
                </p>
              ) : null}
              <ul className="space-y-3">
                {inst.accounts.map((acct) => (
                  <li
                    key={acct.account_id}
                    className="flex flex-wrap items-baseline justify-between gap-2 pb-3 last:border-0"
                    style={{ borderBottom: "1px solid var(--line)" }}
                  >
                    <div>
                      <span className="treasury-ink font-medium">
                        {acct.name ?? "Account"}
                        {acct.mask ? ` · ${acct.mask}` : ""}
                      </span>
                      <span className="block treasury-meta-fine capitalize">
                        {[acct.type, acct.subtype].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div className="text-right tabular-nums">
                      <div>{formatTreasuryMoney(acct.current_balance, acct.iso_currency_code)}</div>
                      {acct.available_balance != null &&
                      acct.available_balance !== acct.current_balance ? (
                        <div className="treasury-meta-fine">
                          Available{" "}
                          {formatTreasuryMoney(acct.available_balance, acct.iso_currency_code)}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {recent.length > 0 ? (
        <section className={embedded ? "treasury-section" : "mt-10"}>
          <h2 className="sec-title">Recent activity</h2>
          {embedded ? (
            <>
              <p className="treasury-meta-fine mb-3">
                Showing latest {recent.length} of {totalCount}
              </p>
              <div className="tx-drill-list">
                {recent.map((tx, i) => (
                  <div key={`${tx.account_id}-${tx.date}-${tx.name}-${i}`} className="tx-drill-row">
                    <span className="tx-drill-date">{tx.date}</span>
                    <span className="tx-drill-payee">{tx.name}</span>
                    <span className="tx-drill-label">{tx.pending ? "Pending" : ""}</span>
                    <span className={amountClass(tx)}>
                      {formatTreasuryMoney(tx.amount, tx.iso_currency_code)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ul className="treasury-tx-list panel">
              {transactions.map((tx, i) => (
                <li
                  key={`${tx.account_id}-${tx.date}-${tx.name}-${i}`}
                  className="flex justify-between gap-4 py-3 px-4 text-sm"
                  style={{ borderBottom: "1px solid var(--line)" }}
                >
                  <div>
                    <span className="treasury-ink font-medium">{tx.name}</span>
                    <span className="block treasury-meta-fine">
                      {tx.date}
                      {tx.pending ? " · Pending" : ""}
                    </span>
                  </div>
                  <span className={`tabular-nums shrink-0 ${amountClass(tx)}`}>
                    {formatTreasuryMoney(tx.amount, tx.iso_currency_code)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  ) : (
    <div className="panel p-8 text-center">
      <p className="treasury-muted mb-4">
        {readOnly
          ? "No banks linked for this client yet."
          : "No banks linked yet. Connect a Sandbox test institution to see balances here."}
      </p>
    </div>
  );

  if (embedded) {
    return <div>{accountsBody}</div>;
  }

  return (
    <div className="treasury-page p-8 max-w-4xl">
      <header className="mb-8">
        <p className="eyebrow">Treasury</p>
        <h1 className="title">{title}</h1>
        <p className="treasury-meta mt-1">{subtitle}</p>
        {headerExtra}
      </header>
      {connectBar}
      {accountsBody}
    </div>
  );
}
