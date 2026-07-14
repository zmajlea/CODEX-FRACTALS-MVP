"use client";

import { Suspense } from "react";
import { PlaidLinkButton } from "@/components/treasury/PlaidLinkButton";
import { useClientGrants } from "@/components/platform/ClientGrantsContext";

export function ClientTreasuryEmptyState() {
  const { grants, activeGrantId } = useClientGrants();
  const active =
    grants.find((g) => g.id === activeGrantId) ??
    grants.find((g) => g.modules?.slug === "treasury") ??
    grants[0];
  const tenantName = active?.tenants?.name;

  return (
    <div className="treasury-page p-8 max-w-lg">
      <header className="mb-8">
        <p className="eyebrow">Treasury</p>
        <h1 className="title">Link your first bank</h1>
        <p className="treasury-muted mt-2">
          Connect a bank account to view balances and recent transactions. Sandbox test
          banks are available in development.
        </p>
        {tenantName ? (
          <p className="treasury-meta mt-2">
            Managed by <span className="treasury-ink font-medium">{tenantName}</span>
          </p>
        ) : null}
      </header>
      <Suspense fallback={<p className="treasury-muted">Loading…</p>}>
        <PlaidLinkButton label="Connect your first bank" />
      </Suspense>
    </div>
  );
}
