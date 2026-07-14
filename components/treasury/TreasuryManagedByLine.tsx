"use client";

import { useClientGrants } from "@/components/platform/ClientGrantsContext";

export function TreasuryManagedByLine() {
  const { grants, activeGrantId } = useClientGrants();
  const active =
    grants.find((g) => g.id === activeGrantId) ??
    grants.find((g) => g.modules?.slug === "treasury") ??
    grants[0];
  const tenantName = active?.tenants?.name;

  if (!tenantName) return null;

  return (
    <p className="treasury-meta mt-2">
      Managed by <span className="treasury-ink font-medium">{tenantName}</span>
    </p>
  );
}
