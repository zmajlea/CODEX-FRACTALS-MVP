"use client";

import { useState } from "react";
import { TreasuryCsvImport } from "@/components/operator/treasury/TreasuryCsvImport";
import { TreasurySourcesList } from "@/components/treasury/TreasurySourcesList";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { TreasuryInstitutionView } from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  clientEmail: string;
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  syncing?: boolean;
  /** Spec 35: hide Sync on CSV-only clients — meaningless without a bank link. */
  showSyncFromBank?: boolean;
  onSync?: () => void;
  onImported?: () => void;
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

export function TreasuryConnectionsPanel({
  clientUserId,
  clientEmail,
  institutions,
  lastSyncedAt,
  syncing = false,
  showSyncFromBank = true,
  onSync,
  onImported,
  onPick,
}: Props) {
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const csvAccounts = institutions
    .filter((i) => i.item_id === "csv-manual")
    .flatMap((i) => i.accounts);

  async function removeCsvImport(accountId: string, displayLabel: string) {
    setBusyAccountId(accountId);
    try {
      const previewRes = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/accounts/${encodeURIComponent(accountId)}`
      );
      const preview = (await previewRes.json()) as {
        error?: string;
        transaction_count?: number;
        mask?: string | null;
        name?: string | null;
      };
      if (!previewRes.ok) {
        throw new Error(preview.error ?? "Failed to load import details");
      }
      const n = preview.transaction_count ?? 0;
      const mask = preview.mask ?? preview.name ?? displayLabel;
      if (
        !confirm(
          `Remove account ${mask} and its ${n} imported transactions? This does not touch your rules or anything you've sent the client. It cannot be undone.`
        )
      ) {
        return;
      }
      const delRes = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/accounts/${encodeURIComponent(accountId)}`,
        { method: "DELETE" }
      );
      const body = (await delRes.json().catch(() => ({}))) as { error?: string };
      if (!delRes.ok) {
        throw new Error(body.error ?? "Failed to remove import");
      }
      onImported?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove import");
    } finally {
      setBusyAccountId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="font-head text-lg mb-3">Your sources</h3>
        <TreasurySourcesList
          institutions={institutions}
          lastSyncedAt={lastSyncedAt}
          readOnly
          onPick={onPick}
        />
        {csvAccounts.length > 0 ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm treasury-meta">
              CSV imports are stored as accounts. Removing an import deletes that
              account and its rows only — not your rules.
            </p>
            <ul className="space-y-2">
              {csvAccounts.map((acct) => {
                const label =
                  acct.mask ?? acct.name ?? acct.account_id.replace(/^csv:/, "");
                return (
                  <li
                    key={acct.account_id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {label}
                      <span className="treasury-meta ml-2">
                        {formatTreasuryMoney(
                          acct.current_balance,
                          acct.iso_currency_code
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="ra"
                      disabled={busyAccountId === acct.account_id}
                      onClick={() => void removeCsvImport(acct.account_id, label)}
                    >
                      {busyAccountId === acct.account_id
                        ? "Removing…"
                        : "Remove import"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <p className="su-note mt-4">
          Bank connections are created by the client — Plaid Link is their verification step.
          Ask them to (re)connect.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <a
            className="btn btn-secondary"
            href={`mailto:${clientEmail}?subject=Please%20reconnect%20your%20bank`}
          >
            Request (re)connect
          </a>
          {showSyncFromBank && onSync ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={syncing}
              onClick={onSync}
            >
              {syncing ? "Syncing…" : "Sync from bank"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="font-head text-lg mb-2">Intake</h3>
        <p className="text-sm text-codex-muted mb-4">
          Import transaction history from a CSV file when the client cannot link a bank.
        </p>
        <TreasuryCsvImport
          clientUserId={clientUserId}
          onImported={onImported}
          onPick={onPick}
        />
      </div>
    </div>
  );
}
