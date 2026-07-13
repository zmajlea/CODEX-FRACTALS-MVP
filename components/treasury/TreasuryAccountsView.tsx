"use client";

import { useMemo } from "react";
import type {
  TreasuryInstitutionView,
  TreasuryTransaction,
} from "@/lib/treasury/types";
import { PlaidLinkButton } from "@/components/treasury/PlaidLinkButton";

export function formatTreasuryMoney(
  amount: number | null,
  currency: string | null
): string {
  if (amount == null) return "—";
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function TotalsByCurrency({ institutions }: { institutions: TreasuryInstitutionView[] }) {
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of institutions) {
      for (const acct of inst.accounts) {
        const code = acct.iso_currency_code ?? "USD";
        const bal = acct.current_balance ?? 0;
        map.set(code, (map.get(code) ?? 0) + bal);
      }
    }
    return [...map.entries()];
  }, [institutions]);

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
  title?: string;
  subtitle?: string;
  showConnectButton?: boolean;
  onRefresh?: () => void;
  onLinked?: () => void;
  headerExtra?: React.ReactNode;
};

export function TreasuryAccountsView({
  institutions,
  transactions,
  loading = false,
  error = null,
  readOnly = false,
  title = "Your accounts",
  subtitle = "Read-only balances and recent transactions from linked banks.",
  showConnectButton = true,
  onRefresh,
  onLinked,
  headerExtra,
}: TreasuryAccountsViewProps) {
  const hasItems = institutions.length > 0;

  if (loading && institutions.length === 0 && !error) {
    return (
      <div className="treasury-page p-8">
        <p className="text-sm text-codex-muted">Loading accounts…</p>
      </div>
    );
  }

  if (error && institutions.length === 0) {
    return (
      <div className="treasury-page p-8">
        <p className="text-sm text-cinnabar" role="alert">
          {error}
        </p>
        {onRefresh ? (
          <button type="button" className="btn btn-secondary mt-4" onClick={onRefresh}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="treasury-page p-8 max-w-4xl">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-codex-muted mb-1">Treasury</p>
        <h1 className="font-head text-2xl text-ink">{title}</h1>
        <p className="text-sm text-codex-muted mt-1">{subtitle}</p>
        {headerExtra}
      </header>

      {!readOnly && showConnectButton ? (
        <div className="flex flex-wrap gap-3 mb-8">
          <PlaidLinkButton
            label={hasItems ? "Connect another bank" : "Connect your first bank"}
            onLinked={onLinked}
          />
          {hasItems && onRefresh ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={onRefresh}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
        </div>
      ) : readOnly && onRefresh ? (
        <div className="flex flex-wrap gap-3 mb-8">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? "Refreshing…" : "Refresh from bank"}
          </button>
        </div>
      ) : null}

      {hasItems ? (
        <>
          <TotalsByCurrency institutions={institutions} />

          <div className="space-y-6 mt-8">
            {institutions.map((inst) => (
              <section key={inst.item_id} className="treasury-institution panel">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h2 className="font-head text-lg">
                    {inst.institution_name ?? "Linked institution"}
                  </h2>
                  {inst.key_destroyed ? (
                    <span className="text-xs text-cinnabar font-medium">
                      Reconnect required
                    </span>
                  ) : inst.needs_reconnect ? (
                    <span className="text-xs text-cinnabar font-medium">
                      Reconnect required
                    </span>
                  ) : null}
                </div>
                {inst.key_destroyed ? (
                  <p className="text-sm text-codex-muted mb-4">
                    Encryption key unavailable. The client must re-link their bank.
                  </p>
                ) : inst.needs_reconnect ? (
                  <p className="text-sm text-codex-muted mb-4">
                    This connection needs to be refreshed. Ask the client to re-link.
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {inst.accounts.map((acct) => (
                    <li
                      key={acct.account_id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sealed-bone/60 pb-3 last:border-0"
                    >
                      <div>
                        <span className="font-medium">
                          {acct.name ?? "Account"}
                          {acct.mask ? ` · ${acct.mask}` : ""}
                        </span>
                        <span className="block text-xs text-codex-muted capitalize">
                          {[acct.type, acct.subtype].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <div className="text-right tabular-nums">
                        <div>
                          {formatTreasuryMoney(acct.current_balance, acct.iso_currency_code)}
                        </div>
                        {acct.available_balance != null &&
                        acct.available_balance !== acct.current_balance ? (
                          <div className="text-xs text-codex-muted">
                            Available{" "}
                            {formatTreasuryMoney(
                              acct.available_balance,
                              acct.iso_currency_code
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {transactions.length > 0 ? (
            <section className="mt-10">
              <h2 className="font-head text-lg mb-4">Recent transactions</h2>
              <ul className="treasury-tx-list panel divide-y divide-sealed-bone/60">
                {transactions.map((tx, i) => (
                  <li
                    key={`${tx.account_id}-${tx.date}-${tx.name}-${i}`}
                    className="flex justify-between gap-4 py-3 px-4 text-sm"
                  >
                    <div>
                      <span className="font-medium">{tx.name}</span>
                      <span className="block text-xs text-codex-muted">
                        {tx.date}
                        {tx.pending ? " · Pending" : ""}
                      </span>
                    </div>
                    <span className="tabular-nums shrink-0">
                      {formatTreasuryMoney(tx.amount, tx.iso_currency_code)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <div className="panel p-8 text-center">
          <p className="text-codex-muted mb-4">
            {readOnly
              ? "No banks linked for this client yet."
              : "No banks linked yet. Connect a Sandbox test institution to see balances here."}
          </p>
        </div>
      )}
    </div>
  );
}
