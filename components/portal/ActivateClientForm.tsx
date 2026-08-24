"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

/** Spec B10 Part B — set password from invite token, then enter treasury. */
export function ActivateClientForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() ?? "", [params]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This invite link is missing a token.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/portal/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = (await res.json()) as {
        error?: string;
        email?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Activation failed");
      }

      const supabase = createClient();
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: json.email!,
        password,
      });
      if (signErr) {
        throw new Error(signErr.message);
      }
      router.replace("/client/treasury");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="treasury-meta" role="alert">
        This invite link is invalid. Ask your advisor to send a new one.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-md">
      <div>
        <h1 className="text-xl font-semibold mb-1">Activate your account</h1>
        <p className="treasury-meta text-sm">
          Choose a password to open your Summit Treasury portal.
        </p>
      </div>
      {error ? (
        <p className="treasury-meta cm-err" role="alert">
          {error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="treasury-meta">Password</span>
        <input
          type="password"
          className="w-full border border-[var(--line)] rounded px-2 py-2 mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />
      </label>
      <label className="block text-sm">
        <span className="treasury-meta">Confirm password</span>
        <input
          type="password"
          className="w-full border border-[var(--line)] rounded px-2 py-2 mt-1"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />
      </label>
      <button type="submit" className="chip" disabled={busy}>
        {busy ? "Activating…" : "Activate and continue"}
      </button>
    </form>
  );
}
