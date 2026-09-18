"use client";

import { useEffect, useState } from "react";

/** Viewport match for phone/tablet shell (&lt;1024). SSR-safe: false until mount. */
export function useMaxWidth(maxPx: number): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const apply = () => setMatch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [maxPx]);
  return match;
}

/** B31 Rules phone/tablet breakpoint — matches shell-phone / B30 ≤1023. */
export function useRulesPhone(): boolean {
  return useMaxWidth(1023);
}
