"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import { assertAbsolutePickParams } from "@/lib/treasury/pickable";
import {
  lastPickOpenedTheDrawer,
  prepareDraftsPickAnnounce,
} from "@/lib/treasury/drafts-drawer-session";

type Props = {
  pickable: Pickable;
  variant: "row" | "header" | "row-draft";
  onPick: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  disabled?: boolean;
  buttonClassName?: string;
  ariaLabel?: string;
};

export function PickButton({
  pickable,
  variant,
  onPick,
  disabled,
  buttonClassName,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const confirmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      const menu = document.getElementById(menuId);
      if (menu?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open, menuId]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled || confirmed) return;
    try {
      assertAbsolutePickParams(pickable.params);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Invalid pick params");
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 220),
      });
    }
    setOpen(true);
  }

  async function choose(draftKind: DraftKind) {
    setOpen(false);
    prepareDraftsPickAnnounce(
      pickable.label || pickable.kind,
      pickable.kind
    );
    await onPick(draftKind, pickable);
    // Spec 46e 9a — morph + → ✓ when the pick did not open the drawer
    if (!lastPickOpenedTheDrawer()) {
      setConfirmed(true);
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => {
        setConfirmed(false);
        confirmTimer.current = null;
      }, 800);
    }
  }

  const glyph = confirmed ? "✓" : "+";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={
          buttonClassName ??
          (variant === "header"
            ? "pkh"
            : variant === "row-draft"
              ? "row-pick"
              : "pk")
        }
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          ariaLabel ??
          (confirmed
            ? "Added to draft"
            : variant === "row-draft"
              ? "Add this transaction to a draft"
              : undefined)
        }
        onClick={openMenu}
        title={confirmed ? "Added" : "Add to draft"}
      >
        {variant === "header" ? (
          <>
            <b>{glyph}</b> {confirmed ? "Added" : "Add to draft"}
          </>
        ) : variant === "row-draft" ? (
          confirmed ? "✓ Added" : "+ Add to draft"
        ) : (
          glyph
        )}
      </button>
      {open && pos ? (
        <div
          id={menuId}
          className="pkmenu"
          role="menu"
          style={{ display: "block", top: pos.top, left: pos.left }}
        >
          <div className="t">{pickable.label}</div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void choose("recommendation")}
          >
            <span className="k">→</span>Add to recommendation
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void choose("question")}
          >
            <span className="k">?</span>Add as question
          </button>
        </div>
      ) : null}
    </>
  );
}
