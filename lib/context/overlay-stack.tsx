"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type OverlayType =
  | "inspector"
  | "settings"
  | "inbox"
  | "record-log"
  | "user-log"
  | "alerts"
  | null;

export type InspectorSequestration = {
  vaultId: string;
  recordId: string;
  pulseId: string;
  fileId?: string | null;
};

type PlaceSnapshot = {
  scrollY: number;
};

type OverlayStackValue = {
  activeOverlay: OverlayType;
  inspectorTarget: InspectorSequestration | null;
  openInspector: (target: InspectorSequestration) => void;
  openOverlay: (type: Exclude<OverlayType, null>) => void;
  closeOverlay: () => void;
  isInspectorOpen: boolean;
};

const OverlayStackContext = createContext<OverlayStackValue | null>(null);

export function OverlayStackProvider({ children }: { children: ReactNode }) {
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [inspectorTarget, setInspectorTarget] =
    useState<InspectorSequestration | null>(null);
  const placeRef = useRef<PlaceSnapshot>({ scrollY: 0 });

  const openInspector = useCallback((target: InspectorSequestration) => {
    placeRef.current = { scrollY: window.scrollY };
    setInspectorTarget(target);
    setActiveOverlay("inspector");
  }, []);

  const openOverlay = useCallback((type: Exclude<OverlayType, null>) => {
    placeRef.current = { scrollY: window.scrollY };
    setActiveOverlay(type);
  }, []);

  const closeOverlay = useCallback(() => {
    setActiveOverlay(null);
    setInspectorTarget(null);
    requestAnimationFrame(() => {
      window.scrollTo(0, placeRef.current.scrollY);
    });
  }, []);

  const value = useMemo(
    () => ({
      activeOverlay,
      inspectorTarget,
      openInspector,
      openOverlay,
      closeOverlay,
      isInspectorOpen: activeOverlay === "inspector",
    }),
    [activeOverlay, closeOverlay, inspectorTarget, openInspector, openOverlay]
  );

  return (
    <OverlayStackContext.Provider value={value}>
      {children}
    </OverlayStackContext.Provider>
  );
}

export function useOverlayStack() {
  const ctx = useContext(OverlayStackContext);
  if (!ctx) {
    throw new Error("useOverlayStack must be used within OverlayStackProvider");
  }
  return ctx;
}
