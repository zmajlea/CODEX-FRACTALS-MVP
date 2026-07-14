"use client";

import { PlaidLinkButton } from "@/components/treasury/PlaidLinkButton";
import { TreasurySourcesList } from "@/components/treasury/TreasurySourcesList";
import type { TreasuryInstitutionView } from "@/lib/treasury/types";

type Props = {
  institutions: TreasuryInstitutionView[];
  lastSyncedAt: string | null;
  csvImportedBy?: string | null;
  onLinked?: () => void;
  onDisconnected?: () => void;
};

export function TreasuryClientConnections({
  institutions,
  lastSyncedAt,
  csvImportedBy,
  onLinked,
  onDisconnected,
}: Props) {
  const hasItems = institutions.length > 0;

  async function handleDisconnect(sourceId: string) {
    const res = await fetch(`/api/treasury/sources/${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to remove source");
    }
    onDisconnected?.();
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="sec-title mb-3">Your sources</h3>
        <TreasurySourcesList
          institutions={institutions}
          lastSyncedAt={lastSyncedAt}
          csvImportedBy={csvImportedBy}
          onDisconnect={handleDisconnect}
          onAccountsChanged={onDisconnected}
        />
        <div className="mt-4">
          <PlaidLinkButton
            label={hasItems ? "Connect another bank" : "Connect your first bank"}
            onLinked={onLinked}
          />
        </div>
      </div>
    </div>
  );
}
