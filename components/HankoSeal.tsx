"use client";

import React from "react";

type HankoSealProps = {
  initials?: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
};

const SIZE = {
  sm: "w-10 h-10 text-[9px]",
  md: "w-14 h-14 text-[11px]",
  lg: "w-20 h-20 text-sm",
};

export default function HankoSeal({
  initials = "FR",
  size = "md",
  onClick,
  disabled = false,
  className = "",
  title = "Apply Hanko seal",
}: HankoSealProps) {
  const shared =
    "relative flex items-center justify-center border-2 border-cinnabar bg-cinnabar/10 text-cinnabar font-head font-bold tracking-tight shadow-[inset_0_2px_6px_rgba(0,0,0,0.12)] rotate-[-4deg] transition-transform " +
    SIZE[size] +
    " " +
    className;

  const inner = (
    <>
      <span
        className="absolute inset-[3px] border border-cinnabar/40 pointer-events-none"
        aria-hidden
      />
      <span className="leading-none">{initials}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={
          shared +
          " hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed hanko-stamp"
        }
      >
        {inner}
      </button>
    );
  }

  return <div className={shared + " hanko-stamp"}>{inner}</div>;
}
