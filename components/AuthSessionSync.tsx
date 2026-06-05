"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";

/**
 * Keeps browser auth state aligned with cookies refreshed by the Next.js proxy.
 * Redirects to login when the session is cleared after a failed token refresh.
 */
export default function AuthSessionSync() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearAuthSessionStorage();
        router.replace("/login?error=Session expired. Please sign in again.");
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

  return null;
}
