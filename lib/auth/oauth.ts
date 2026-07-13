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
export function startGoogleSignIn(options?: {
  flow?: "portal" | "client";
  nextPath?: string;
  invite?: string;
}) {
  clearAuthSessionStorage();

  const origin = getBrowserOrigin();
  const params = new URLSearchParams();
  params.set("flow", options?.flow ?? "client");
  if (options?.nextPath) params.set("next", options.nextPath);
  if (options?.invite) params.set("invite", options.invite);

  window.location.assign(`${origin}/api/auth/google?${params.toString()}`);
}
