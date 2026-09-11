"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { BcnRail, type BcnRailGroup, type BcnRailItem } from "@/components/bcn/BcnRail";
import { BcnTopbarContinuity } from "@/components/bcn/BcnTopbarContinuity";
import { SealFx } from "@/components/bcn/SealFx";
import type { SealFxPhase } from "@/components/bcn/hooks/useSeal";
import { tokenOverridesToStyle } from "@/lib/branding/resolve-theme";

export type BcnContinuityShellMode = "client" | "operator";

type Props = {
  mode: BcnContinuityShellMode;
  dataBrand?: string;
  dataR1?: boolean;
  logoUrl?: string | null;
  wordmark: string;
  homeHref?: string;
  recordPill: {
    primary: string;
    secondary?: string;
  };
  who?: string | null;
  keyUnlocked?: boolean;
  railGroups: BcnRailGroup[];
  railFootItems?: BcnRailItem[];
  railHead?: ReactNode;
  tokenOverrides?: Record<string, string>;
  children: ReactNode;
  sectionSealed?: boolean;
  sealFxPhase?: SealFxPhase;
  sealCaption?: string;
  onWaxAnimationEnd?: (animationName: string) => void;
  onCapAnimationEnd?: (animationName: string) => void;
  onLogout?: () => void;
  showBcnSolutionLine?: boolean;
};

export function BcnContinuityShell({
  mode,
  dataBrand,
  dataR1,
  logoUrl,
  wordmark,
  homeHref,
  recordPill,
  who,
  keyUnlocked = true,
  railGroups,
  railFootItems,
  railHead,
  children,
  sectionSealed = false,
  sealFxPhase = "off",
  sealCaption,
  onWaxAnimationEnd,
  onCapAnimationEnd,
  onLogout,
  showBcnSolutionLine = mode === "operator",
  tokenOverrides = {},
}: Props) {
  const [railPinned, setRailPinned] = useState(dataR1 ?? false);
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

  const appClass = [
    "app",
    "cs",
    railPinned ? "rail-pinned" : "",
    sectionSealed ? "sec-sealed" : "",
    navOpen ? "nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        className={appClass}
        id="app"
        {...(dataBrand ? { "data-brand": dataBrand } : {})}
        {...(dataR1 ? { "data-r1": "" } : {})}
        style={tokenOverridesToStyle(tokenOverrides) as CSSProperties}
      >
        <BcnTopbarContinuity
          wordmark={wordmark}
          dataBrand={dataBrand}
          logoUrl={logoUrl}
          homeHref={homeHref}
          recordPill={recordPill}
          who={who}
          keyUnlocked={keyUnlocked}
          navOpen={navOpen}
          onNavToggle={() => setNavOpen((v) => !v)}
        />
        <div
          className={`app-nav-scrim${navOpen ? " on" : ""}`}
          aria-hidden={!navOpen}
          onClick={() => setNavOpen(false)}
        />
        <div className="app-row">
          <aside className="rail app-rail" id="rail">
            <BcnRail
              groups={railGroups}
              footItems={railFootItems}
              headContent={railHead}
              pinned={railPinned}
              dataBrand={dataBrand}
              onTogglePin={() => setRailPinned((v) => !v)}
              onLogout={onLogout}
              onNavigate={() => setNavOpen(false)}
              showPoweredBy
              showBcnSolutionLine={showBcnSolutionLine}
            />
          </aside>
          <main className="app-main">
            <div className="app-wrap">
              <div id="viewhost">{children}</div>
            </div>
          </main>
        </div>
      </div>

      <SealFx
        phase={sealFxPhase}
        dataBrand={dataBrand}
        caption={
          sealCaption ??
          (dataBrand === "summit"
            ? "Verified. Nothing slips."
            : "Preparation is an act of love.")
        }
        onWaxAnimationEnd={onWaxAnimationEnd}
        onCapAnimationEnd={onCapAnimationEnd}
      />
    </>
  );
}
