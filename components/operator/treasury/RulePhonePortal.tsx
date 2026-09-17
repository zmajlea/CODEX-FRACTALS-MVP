"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  children: ReactNode;
  /** Extra class on the fixed overlay root (e.g. rm-sheet--bottom). */
  className?: string;
  /** Accessible name for the dialog. */
  "aria-label"?: string;
};

/**
 * B31 — Rules overlays must portal to document.body.
 * Never render inside `.rules-screen` (container-type would trap position:fixed).
 * z-index 1020 sits above B30 topbar (1010) / rail (1001) / scrim (1000).
 */
export function RulePhonePortal({
  open,
  children,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={`rm-overlay${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-r1=""
      data-brand="summit"
      data-rm-portal="true"
    >
      {children}
    </div>,
    document.body
  );
}
