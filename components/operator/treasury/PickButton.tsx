"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import { assertAbsolutePickParams } from "@/lib/treasury/pickable";

type Props = {
  pickable: Pickable;
  variant: "row" | "header";
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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
    if (disabled) return;
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
    await onPick(draftKind, pickable);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={
          buttonClassName ?? (variant === "header" ? "pkh" : "pk")
        }
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={openMenu}
        title="Add to draft"
      >
        {variant === "header" ? (
          <>
            <b>+</b> Add to draft
          </>
        ) : (
          "+"
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
          <button type="button" role="menuitem" onClick={() => void choose("recommendation")}>
            <span className="k">→</span>Add to recommendation
          </button>
          <button type="button" role="menuitem" onClick={() => void choose("question")}>
            <span className="k">?</span>Add as question
          </button>
        </div>
      ) : null}
    </>
  );
}
