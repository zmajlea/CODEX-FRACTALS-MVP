"use client";

import { useCallback, useRef, useState } from "react";

export type SealState = "idle" | "sealing" | "sealed";
export type SealFxPhase = "off" | "on" | "play";

export function useSeal(onCommit: () => Promise<void>) {
  const [state, setState] = useState<SealState>("idle");
  const [sealFxPhase, setSealFxPhase] = useState<SealFxPhase>("off");
  const sealingRef = useRef(false);

  const resetSealFx = useCallback(() => {
    setSealFxPhase("off");
  }, []);

  const handleSeal = useCallback(() => {
    if (state !== "idle" || sealingRef.current) return;

    sealingRef.current = true;
    setState("sealing");
    setSealFxPhase("on");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSealFxPhase("play");
      });
    });
  }, [state]);

  const handleWaxAnimationEnd = useCallback(
    async (animationName: string) => {
      if (animationName !== "stamp" || !sealingRef.current) return;

      try {
        await onCommit();
        setState("sealed");
      } catch {
        sealingRef.current = false;
        setState("idle");
        resetSealFx();
      }
    },
    [onCommit, resetSealFx]
  );

  const handleCapAnimationEnd = useCallback(
    (animationName: string) => {
      if (animationName !== "cap" || !sealingRef.current) return;
      sealingRef.current = false;
      resetSealFx();
    },
    [resetSealFx]
  );

  const setStateManual = useCallback((next: SealState) => {
    if (next === "idle") {
      sealingRef.current = false;
      resetSealFx();
    }
    setState(next);
  }, [resetSealFx]);

  return {
    state,
    sealFxPhase,
    handleSeal,
    handleWaxAnimationEnd,
    handleCapAnimationEnd,
    setState: setStateManual,
  };
}
