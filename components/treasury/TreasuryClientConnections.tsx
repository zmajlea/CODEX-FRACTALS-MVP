"use client";

import { PlaidLinkButton } from "@/components/treasury/PlaidLinkButton";
import { formatTreasuryAsOf, formatTreasuryMoney } from "@/lib/treasury/format";
import type { TreasuryInstitutionView } from "@/lib/treasury/types";

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  csvImportedBy?: string | null;
  onLinked?: () => void;
  onDisconnected?: () => void;
};

function requestChange() {
  window.alert(
    "Your request has been noted. Your Summit team will follow up to update this account."
  );
}

export function TreasuryClientConnections({
  institutions,
  lastSyncedAt,
  csvImportedBy,
  onLinked,
}: Props) {
  const hasItems = institutions.length > 0;
  const syncedLabel = formatTreasuryAsOf(lastSyncedAt);

  return (
    <div>
      <h1 className="rh1">Your sources</h1>
      <p className="rh-src">
        You view your imported book here. To change an account, use Request a change and your
        Summit team will update it.
      </p>

      {institutions.length === 0 ? (
        <div className="cash-hero">
          <p className="meta">No sources linked yet.</p>
          <div className="mt-4">
            <PlaidLinkButton label="Connect your first bank" onLinked={onLinked} />
          </div>
        </div>
      ) : (
        institutions.map((inst) => {
          const isCsv = inst.item_id === "csv-manual";
          return (
            <div key={inst.item_id} className="cash-hero">
              {isCsv && csvImportedBy ? (
                <p className="meta" style={{ margin: "0 0 4px" }}>
                  Imported by your Summit team.
                </p>
              ) : null}
              {isCsv ? (
                <p className="meta" style={{ margin: "0 0 14px" }}>
                  Manual edits stick until a CSV import provides a new balance for that account.
                </p>
              ) : (
                <p className="meta" style={{ margin: "0 0 14px" }}>
                  Synced · {syncedLabel}
                </p>
              )}
              {inst.accounts.map((acct) => {
                const meta = [acct.type, acct.subtype].filter(Boolean).join(", ");
                const label = acct.mask
                  ? `${acct.name ?? "Account"} · ····${acct.mask}`
                  : acct.name ?? "Account";
                return (
                  <div key={acct.account_id} className="acct-bar">
                    <span>
                      {label}
                      {meta ? ` ${meta}` : ""}{" "}
                      <span className="ab-src">
                        {isCsv ? "Imported (CSV)" : "Bank feed"}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span className="amt num">
                        {formatTreasuryMoney(
                          acct.current_balance,
                          acct.iso_currency_code
                        )}
                      </span>
                      <button
                        type="button"
                        className="req-change"
                        onClick={requestChange}
                      >
                        Request a change
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {hasItems ? (
        <div className="mt-4">
          <PlaidLinkButton
            label="Connect another bank"
            onLinked={onLinked}
          />
        </div>
      ) : null}
    </div>
  );
}
