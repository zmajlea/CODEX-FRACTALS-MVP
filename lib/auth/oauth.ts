"use client";

import { clearVaultSessionKeys } from "@/lib/vault-session";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/utils/supabase/client";

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

export async function signInWithGoogle(nextPath = "/switchboard") {
  clearAuthSessionStorage();

  const supabase = createClient();
  const origin =
    typeof window !== "undefined"
      ? getSiteUrl(window.location.origin)
      : getSiteUrl();
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}
