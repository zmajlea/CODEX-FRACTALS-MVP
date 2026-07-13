"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ClientModuleRailSwitcher } from "@/components/platform/ClientModuleRailSwitcher";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BcnThemeStyleInjector } from "@/components/bcn/BcnThemeStyleInjector";

type Grant = {
  id: string;
  module_id: string;
  distributor_tenant_id: string;
  vault_id: string | null;
  modules: { slug: string; name: string; route_base: string } | null;
  tenants: { name: string } | null;
};

type Props = {
  children: ReactNode;
  styleBlock: string;
  dataBrand: string;
  tenantId: string;
  tenantName: string;
  grants: Grant[];
  activeGrantId?: string;
};

export function ClientShellFrame({
  children,
  styleBlock,
  dataBrand,
  tenantId,
  tenantName,
  grants,
  activeGrantId,
}: Props) {
  const pathname = usePathname();
  const bcnOwnsChrome = pathname?.startsWith("/client/bcn");

  if (bcnOwnsChrome) {
    return (
      <>
        <style>{styleBlock}</style>
        <BcnThemeStyleInjector />
        {children}
      </>
    );
  }

  return (
    <div
      className="app cs min-h-screen"
      id="app"
      data-brand={dataBrand}
      data-bcn-tenant={tenantId}
    >
      <style>{styleBlock}</style>
      <BcnThemeStyleInjector />
      <header className="topbar appbar">
        <span className="wm-name">{tenantName}</span>
        <span className="grow" />
        <SignOutButton className="btn sm ghost" />
      </header>
      <div className="app-row">
        <aside className="rail app-rail" id="rail">
          <ClientModuleRailSwitcher />
        </aside>
        <main className="app-main">
          <div className="app-wrap">{children}</div>
        </main>
      </div>
    </div>
  );
}
