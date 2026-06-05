"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearVaultSessionKey,
  getVaultSessionKey,
  setVaultSessionKey,
} from "@/lib/vault-session";

export type ActiveVaultState = {
  id: string;
  name: string;
} | null;

type ActiveVaultContextValue = {
  activeVault: ActiveVaultState;
  setActiveVault: (vault: ActiveVaultState) => void;
  isUnlocked: (vaultId: string) => boolean;
  unlockVault: (vaultId: string, key: string) => void;
  lockVault: (vaultId: string) => void;
  handshakePhase: "idle" | "transitioning" | "blocked";
  startHandshake: () => void;
  completeHandshake: () => void;
  blockHandshake: () => void;
};

const ActiveVaultContext = createContext<ActiveVaultContextValue | null>(null);

export function ActiveVaultProvider({ children }: { children: ReactNode }) {
  const [activeVault, setActiveVault] = useState<ActiveVaultState>(null);
  const [handshakePhase, setHandshakePhase] = useState<
    "idle" | "transitioning" | "blocked"
  >("idle");
  const [unlockedRevision, setUnlockedRevision] = useState(0);

  const isUnlocked = useCallback(
    (vaultId: string) => {
      void unlockedRevision;
      return Boolean(getVaultSessionKey(vaultId));
    },
    [unlockedRevision]
  );

  const unlockVault = useCallback((vaultId: string, key: string) => {
    setVaultSessionKey(vaultId, key);
    setUnlockedRevision((n) => n + 1);
  }, []);

  const lockVault = useCallback((vaultId: string) => {
    clearVaultSessionKey(vaultId);
    setUnlockedRevision((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      activeVault,
      setActiveVault,
      isUnlocked,
      unlockVault,
      lockVault,
      handshakePhase,
      startHandshake: () => setHandshakePhase("transitioning"),
      completeHandshake: () => setHandshakePhase("idle"),
      blockHandshake: () => setHandshakePhase("blocked"),
    }),
    [activeVault, handshakePhase, isUnlocked, lockVault, unlockVault]
  );

  return (
    <ActiveVaultContext.Provider value={value}>
      {children}
    </ActiveVaultContext.Provider>
  );
}

export function useActiveVault() {
  const ctx = useContext(ActiveVaultContext);
  if (!ctx) {
    throw new Error("useActiveVault must be used within ActiveVaultProvider");
  }
  return ctx;
}
