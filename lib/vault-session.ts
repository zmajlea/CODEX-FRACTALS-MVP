export const getVaultSessionKeyStorageKey = (vaultId: string) =>
  `codexone_key_${vaultId}`;

export function getVaultSessionKey(vaultId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(getVaultSessionKeyStorageKey(vaultId));
  } catch {
    return null;
  }
}

export function setVaultSessionKey(vaultId: string, key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getVaultSessionKeyStorageKey(vaultId), key);
  } catch {
    // ignore
  }
}

export function clearVaultSessionKey(vaultId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getVaultSessionKeyStorageKey(vaultId));
  } catch {
    // ignore
  }
}

// Hybrid fallback: prefer session key, but allow legacy localStorage key.
export function getVaultKeyWithFallback(vaultId: string): string | null {
  const sessionKey = getVaultSessionKey(vaultId);
  if (sessionKey) return sessionKey;

  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`codexone_encryption_key_${vaultId}`);
  } catch {
    return null;
  }
}

