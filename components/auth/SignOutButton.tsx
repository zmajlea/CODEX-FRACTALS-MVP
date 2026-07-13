"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";
import { clearDerivedKeyCache } from "@/lib/encryption";
import { createClient } from "@/utils/supabase/client";

type Props = {
  className?: string;
};

export function SignOutButton({ className = "" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    clearAuthSessionStorage();
    clearDerivedKeyCache();
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={busy}
      className={`text-sm text-codex-muted hover:text-obsidian disabled:opacity-50 ${className}`.trim()}
    >
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
