"use client";

import { Suspense } from "react";
import { PlaidLinkButton } from "@/components/treasury/PlaidLinkButton";
import { TreasuryManagedByLine } from "@/components/treasury/TreasuryManagedByLine";

export function ClientTreasuryEmptyState() {
  return (
    <div className="treasury-page p-8 max-w-lg">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-codex-muted mb-1">Treasury</p>
        <h1 className="font-head text-2xl text-ink">Link your first bank</h1>
        <p className="text-sm text-codex-muted mt-2">
          Connect a bank account to view balances and recent transactions. Sandbox test
          banks are available in development.
        </p>
        <TreasuryManagedByLine />
      </header>
      <Suspense fallback={<p className="text-sm">Loading…</p>}>
        <PlaidLinkButton label="Connect your first bank" />
      </Suspense>
    </div>
  );
}
