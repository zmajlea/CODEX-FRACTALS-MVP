"use client";

import { TreasuryCsvImport } from "@/components/operator/treasury/TreasuryCsvImport";
import { TreasurySourcesList } from "@/components/treasury/TreasurySourcesList";
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
