"use client";

import { useCallback, useState } from "react";

export type SealState = "idle" | "sealing" | "sealed";

export function useSeal(onCommit: () => Promise<void>) {
  const [state, setState] = useState<SealState>("idle");

  const handleSeal = useCallback(async () => {
    if (state !== "idle") return;
    setState("sealing");
    try {
      await onCommit();
      setState("sealed");
    } catch {
      setState("idle");
      throw new Error("Seal failed");
    }
  }, [onCommit, state]);

  return { state, handleSeal, setState };
}
