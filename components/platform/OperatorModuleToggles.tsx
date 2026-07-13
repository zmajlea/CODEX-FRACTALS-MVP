"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type ModuleRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

export type TenantRow = {
  id: string;
  name: string;
  domain_slug: string;
};

type Entitlement = {
  tenant_id: string;
  module_slug: string;
  allowed: boolean;
};

type Props = {
  tenants: TenantRow[];
  modules: ModuleRow[];
  entitlements: Entitlement[];
};

export function OperatorModuleToggles({
  tenants,
  modules,
  entitlements: initialEntitlements,
}: Props) {
  const supabase = createClient();
  const [entitlements, setEntitlements] = useState(initialEntitlements);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const operatorTenants = tenants.filter((t) => t.domain_slug !== "codexone");

  const isAllowed = useCallback(
    (tenantId: string, moduleSlug: string) => {
      const row = entitlements.find(
        (e) => e.tenant_id === tenantId && e.module_slug === moduleSlug
      );
      return row?.allowed ?? false;
    },
    [entitlements]
  );

  async function toggle(tenantId: string, moduleSlug: string, allowed: boolean) {
    const key = `${tenantId}:${moduleSlug}`;
    setBusyKey(key);
    setErr(null);

    const { error } = await supabase.rpc("set_operator_module", {
      p_tenant_id: tenantId,
      p_module_slug: moduleSlug,
      p_allowed: allowed,
    });

    if (error) {
      setErr(error.message);
    } else {
      setEntitlements((prev) => {
        const rest = prev.filter(
          (e) => !(e.tenant_id === tenantId && e.module_slug === moduleSlug)
        );
        return [...rest, { tenant_id: tenantId, module_slug: moduleSlug, allowed }];
      });
    }
    setBusyKey(null);
  }

  if (operatorTenants.length === 0 || modules.length === 0) {
    return null;
  }

  return (
    <div className="border border-bone rounded-xl p-6 bg-white overflow-x-auto">
      <h2 className="font-head text-lg mb-2">Module entitlements</h2>
      <p className="text-sm text-codex-muted mb-4">
        Enable which modules each Operator firm can sell to clients. New firms default to all active modules.
      </p>
      {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
      <table className="w-full text-sm min-w-[32rem]">
        <thead>
          <tr className="text-left text-codex-muted border-b border-bone">
            <th className="pb-2 pr-4">Firm</th>
            {modules.map((m) => (
              <th key={m.id} className="pb-2 px-2 text-center">
                {m.name}
                {m.status === "beta" ? " (β)" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {operatorTenants.map((t) => (
            <tr key={t.id} className="border-b border-bone/50">
              <td className="py-2 pr-4">
                {t.name}
                <span className="block text-xs text-codex-muted">{t.domain_slug}</span>
              </td>
              {modules.map((m) => {
                const key = `${t.id}:${m.slug}`;
                const checked = isAllowed(t.id, m.slug);
                return (
                  <td key={m.id} className="py-2 px-2 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busyKey === key}
                      onChange={(e) => void toggle(t.id, m.slug, e.target.checked)}
                      aria-label={`${m.name} for ${t.name}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
