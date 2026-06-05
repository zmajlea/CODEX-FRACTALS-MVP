"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type FocusContextValue = {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  orderedIds: string[];
  setOrderedIds: (ids: string[]) => void;
  moveFocus: (direction: "up" | "down") => void;
  registerKeyboard: (enabled: boolean) => void;
};

const FocusContext = createContext<FocusContextValue | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);

  const moveFocus = useCallback(
    (direction: "up" | "down") => {
      if (orderedIds.length === 0) return;
      const idx = focusedId ? orderedIds.indexOf(focusedId) : -1;
      const next =
        direction === "down"
          ? Math.min(idx + 1, orderedIds.length - 1)
          : Math.max(idx - 1, 0);
      setFocusedId(orderedIds[next] ?? null);
    },
    [focusedId, orderedIds]
  );

  useEffect(() => {
    if (!keyboardEnabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus("down");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus("up");
      } else if (e.key === "Escape") {
        setFocusedId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardEnabled, moveFocus]);

  const value = useMemo(
    () => ({
      focusedId,
      setFocusedId,
      orderedIds,
      setOrderedIds,
      moveFocus,
      registerKeyboard: setKeyboardEnabled,
    }),
    [focusedId, moveFocus, orderedIds]
  );

  return (
    <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
  );
}

export function useFocus() {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocus must be used within FocusProvider");
  return ctx;
}
