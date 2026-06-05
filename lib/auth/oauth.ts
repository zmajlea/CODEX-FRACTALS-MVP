"use client";

import { clearVaultSessionKeys } from "@/lib/vault-session";
import { getBrowserOrigin } from "@/lib/request-origin";

export function clearAuthSessionStorage() {
  if (typeof window === "undefined") return;
  window.sessionStorage.clear();
  clearVaultSessionKeys();
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith("codexone_encryption_key_")) {
      window.localStorage.removeItem(key);
    }
  }
}

/** Full-page navigation — server builds redirectTo from Vercel forwarded headers. */
export function startGoogleSignIn(nextPath = "/switchboard") {
  clearAuthSessionStorage();

  const origin = getBrowserOrigin();
  const next = encodeURIComponent(nextPath);
  window.location.assign(`${origin}/api/auth/google?next=${next}`);
}
