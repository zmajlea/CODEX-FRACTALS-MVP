"use client";

import { useState } from "react";
import { BcnIcon } from "@/components/bcn/BcnIcon";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { TreasuryManualAccountForm } from "@/components/treasury/TreasuryManualAccountForm";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { TreasuryAccountView, TreasuryInstitutionView } from "@/lib/treasury/types";

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  readOnly?: boolean;
  csvImportedBy?: string | null;
  onDisconnect?: (sourceId: string, sourceName: string) => Promise<void>;
  onAccountsChanged?: () => void;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

export function TreasurySourcesList({
  institutions,
  lastSyncedAt,
  readOnly = false,
  csvImportedBy,
  onDisconnect,
  onAccountsChanged,
  onPick,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<TreasuryAccountView | null>(null);
  const [addingManual, setAddingManual] = useState(false);

  if (institutions.length === 0) {
    return (
      <p className="text-sm treasury-muted">
        {readOnly
          ? "No sources linked for this client yet."
          : "No banks linked yet. Connect a bank below."}
      </p>
    );
  }

  const syncedLabel = formatTreasuryAsOf(lastSyncedAt);

  async function handleDisconnect(sourceId: string, sourceName: string) {
    if (!onDisconnect) return;
    const label = sourceName ?? "this source";
    if (!confirm(`Remove ${label}? Balances and synced transactions from this source will be removed.`)) {
      return;
    }
    setBusyId(sourceId);
    try {
      await onDisconnect(sourceId, label);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove source");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveAccount(acct: TreasuryAccountView) {
    if (!confirm(`Remove ${acct.name ?? "this account"}? Its transactions will also be removed.`)) {
      return;
    }
    setBusyId(acct.account_id);
    try {
      const res = await fetch(
        `/api/treasury/manual-accounts/${encodeURIComponent(acct.account_id)}`,
        { method: "DELETE" }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to remove account");
      }
      onAccountsChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove account");
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved() {
    setEditingAccount(null);
    setAddingManual(false);
    onAccountsChanged?.();
  }

  return (
    <div className="srclist">
      {institutions.map((inst) => {
        const isCsv = inst.item_id === "csv-manual";
        const needsReconnect = inst.needs_reconnect || inst.key_destroyed;
        const kind = isCsv ? "CSV import · manual accounts" : "Bank · synced via Plaid";
        let status = needsReconnect
          ? "Reconnect required"
          : `Synced · ${syncedLabel}`;
        if (isCsv && !readOnly && csvImportedBy) {
          status = `Imported by ${csvImportedBy}`;
        } else if (isCsv && readOnly) {
          status = `Synced · ${syncedLabel}`;
        }

        const canEditAccounts = isCsv && !readOnly;

        return (
          <div key={inst.item_id} className="srccard srccard-expanded">
            <div className="srccard-head">
              <span className="src-ic">
                <BcnIcon name={isCsv ? "doc" : "building"} />
              </span>
              <div className="src-body">
                <div className="src-name">{inst.institution_name ?? "Linked source"}</div>
                <div className="src-kind">{kind}</div>
              </div>
              <div className="src-status">
                {needsReconnect ? (
                  <span className="text-cinnabar font-medium">{status}</span>
                ) : (
                  <span className="src-imp">
                    <span className="src-dot imp" />
                    {status}
                  </span>
                )}
              </div>
            </div>

            {!isCsv && !readOnly ? (
              <p className="src-plaid-note text-xs treasury-meta-fine">
                Accounts under a bank connection come from the bank. To track something the feed
                misses, add it under a manual source.
              </p>
            ) : null}

            {canEditAccounts && !readOnly ? (
              <p className="src-plaid-note text-xs treasury-meta-fine">
                Manual edits stick until a CSV import provides a new balance for that account.
              </p>
            ) : null}

            {inst.accounts.length > 0 ? (
              <ul className="src-accounts">
                {inst.accounts.map((acct) => (
                  <li key={acct.account_id} className="src-account-row">
                    {editingAccount?.account_id === acct.account_id ? (
                      <div className="w-full">
                        <TreasuryManualAccountForm
                          account={acct}
                          onSaved={handleSaved}
                          onCancel={() => setEditingAccount(null)}
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="src-account-name">
                            {acct.name ?? "Account"}
                            {acct.mask ? ` · ${acct.mask}` : ""}
                          </span>
                          {(acct.type || acct.subtype) && (
                            <span className="src-account-meta">
                              {[acct.type, acct.subtype].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="src-account-balance tabular-nums">
                            {formatTreasuryMoney(acct.current_balance, acct.iso_currency_code)}
                          </span>
                          {onPick ? (
                            <PickButton
                              variant="row"
                              pickable={{
                                kind: "account",
                                ref: acct.account_id,
                                label: `${acct.name ?? "Account"}${acct.mask ? ` · ${acct.mask}` : ""}`,
                                sublabel: formatTreasuryMoney(
                                  acct.current_balance,
                                  acct.iso_currency_code
                                ),
                              }}
                              onPick={onPick}
                            />
                          ) : null}
                          {canEditAccounts ? (
                            <span className="flex gap-1 ml-2">
                              <button
                                type="button"
                                className="text-xs treasury-meta-fine underline"
                                onClick={() => {
                                  setAddingManual(false);
                                  setEditingAccount(acct);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-xs text-cinnabar underline"
                                disabled={busyId === acct.account_id}
                                onClick={() => void handleRemoveAccount(acct)}
                              >
                                Remove
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              !addingManual ? (
                <p className="src-accounts-empty text-xs treasury-meta-fine">
                  {canEditAccounts
                    ? "No manual accounts yet. Add one below."
                    : "No accounts in this source."}
                </p>
              ) : null
            )}

            {canEditAccounts && addingManual ? (
              <div className="src-account-form-wrap">
                <TreasuryManualAccountForm
                  onSaved={handleSaved}
                  onCancel={() => setAddingManual(false)}
                />
              </div>
            ) : null}

            <div className="src-actions flex flex-wrap gap-2">
              {canEditAccounts && !addingManual && !editingAccount ? (
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => setAddingManual(true)}
                >
                  Add account
                </button>
              ) : null}
              {!readOnly && onDisconnect && !isCsv ? (
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  disabled={busyId === inst.item_id}
                  onClick={() => void handleDisconnect(inst.item_id, inst.institution_name ?? "source")}
                >
                  {busyId === inst.item_id ? "Removing…" : "Remove source"}
                </button>
              ) : null}
              {!readOnly && onDisconnect && isCsv && inst.accounts.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  disabled={busyId === inst.item_id}
                  onClick={() => void handleDisconnect(inst.item_id, inst.institution_name ?? "source")}
                >
                  {busyId === inst.item_id ? "Removing…" : "Remove all manual accounts"}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
