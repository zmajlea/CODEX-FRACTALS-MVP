"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ClientModuleRailSwitcher } from "@/components/platform/ClientModuleRailSwitcher";
import { RailBrandFoot } from "@/components/bcn/RailBrandFoot";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BcnThemeStyleInjector } from "@/components/bcn/BcnThemeStyleInjector";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";

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
  const theme = useBcnThemeOptional();
  const displayName = theme?.wordmark?.trim() || tenantName;
  const bcnOwnsChrome = pathname?.startsWith("/client/bcn");
  const treasuryR1 = pathname?.startsWith("/client/treasury");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setNavOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  if (bcnOwnsChrome) {
    return (
      <>
        <style>{styleBlock}</style>
        <BcnThemeStyleInjector />
        {children}
      </>
    );
  }

  const appClass = [
    "app",
    "cs",
    "min-h-screen",
    treasuryR1 ? "rail-pinned" : "",
    navOpen ? "nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={appClass}
      id="app"
      data-brand={dataBrand}
      data-bcn-tenant={tenantId}
      {...(treasuryR1 ? { "data-r1": "" } : {})}
    >
      <style>{styleBlock}</style>
      <BcnThemeStyleInjector />
      <header className="topbar appbar">
        <button
          type="button"
          className="navbtn"
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navOpen}
          aria-controls="rail"
          onClick={() => setNavOpen((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {navOpen ? (
              <path d="M4 4l12 12M16 4L4 16" />
            ) : (
              <path d="M3 5h14M3 10h14M3 15h14" />
            )}
          </svg>
        </button>
        <span className="wm-name">{displayName}</span>
        <span className="grow" />
        <SignOutButton className="btn sm ghost" />
      </header>
      <div
        className={`app-nav-scrim${navOpen ? " on" : ""}`}
        aria-hidden={!navOpen}
        onClick={() => setNavOpen(false)}
      />
      <div className="app-row">
        <aside
          className="rail app-rail flex flex-col"
          id="rail"
          onClickCapture={(e) => {
            if (!navOpen) return;
            const t = e.target as HTMLElement | null;
            if (t?.closest("a,button")) setNavOpen(false);
          }}
        >
          <div className="flex-1 min-h-0">
            <ClientModuleRailSwitcher />
          </div>
          <RailBrandFoot showPoweredBy />
        </aside>
        <main className="app-main">
          <div className="app-wrap">{children}</div>
        </main>
      </div>
    </div>
  );
}
