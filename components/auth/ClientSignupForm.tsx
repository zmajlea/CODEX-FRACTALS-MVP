"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { AuthFormShell } from "@/components/auth/AuthFormShell";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";
import {
  CLIENT_LOGIN,
  isLegacyDefaultNext,
  PORTAL_LOGIN,
  resolveClientLoginPath,
} from "@/lib/auth/login-flow";
import { createClient } from "@/utils/supabase/client";

type InvitePreview = {
  valid: boolean;
  email?: string;
  tenant_name?: string;
  module_name?: string;
};

export function ClientSignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const next = searchParams.get("next");

  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invite) return;
    const supabase = createClient();
    void supabase.rpc("get_client_invite_preview", { p_token: invite }).then(({ data }) => {
      const preview = data as InvitePreview | null;
      if (preview?.valid && preview.email) {
        setInvitePreview(preview);
        setEmail(preview.email);
      }
    });
  }, [invite]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      clearAuthSessionStorage();
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Check your email to confirm, then sign in.");
        return;
      }

      const target = await resolveClientLoginPath(supabase, user, {
        next: isLegacyDefaultNext(next) ? null : next,
        inviteToken: invite,
      });

      router.push(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFormShell
      title="Create client account"
      subtitle={
        invite
          ? "Use the email your advisor invited. After signup you'll enter your module."
          : "Anyone can register. Link your account when your advisor sends an invite."
      }
      footer={
        <div className="auth-switch mt-6 text-center text-sm">
          Already have an account?{" "}
          <Link
            href={invite ? `${CLIENT_LOGIN}?invite=${invite}` : CLIENT_LOGIN}
            className="auth-switch-link"
          >
            Sign in
          </Link>
          <p className="mt-2">
            Staff?{" "}
            <Link href={PORTAL_LOGIN} className="auth-switch-link">
              Portal login
            </Link>
          </p>
        </div>
      }
    >
      {invitePreview?.valid && (
        <div className="auth-alert auth-alert-success mb-4 text-sm">
          Join <strong>{invitePreview.tenant_name}</strong> —{" "}
          <strong>{invitePreview.module_name}</strong>
        </div>
      )}

      {error && <div className="auth-alert auth-alert-error">{error}</div>}

      <GoogleSignInButton
        flow="client"
        invite={invite ?? undefined}
        nextPath={isLegacyDefaultNext(next) ? undefined : (next ?? undefined)}
        disabled={loading}
        label="Sign up with Google"
      />

      <div className="auth-divider">
        <span />
        <p>or</p>
        <span />
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <label className="auth-label" htmlFor="name">
          Full name
        </label>
        <input
          id="name"
          className="auth-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <label className="auth-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="auth-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={Boolean(invitePreview?.email)}
          required
        />

        <label className="auth-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="auth-input"
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="auth-btn-primary" type="submit" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthFormShell>
  );
}
