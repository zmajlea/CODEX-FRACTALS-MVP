"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AuthFormShell } from "@/components/auth/AuthFormShell";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";
import {
  CLIENT_LOGIN,
  getStaffAccess,
  isLegacyDefaultNext,
  PORTAL_LOGIN,
  resolvePortalLoginPath,
} from "@/lib/auth/login-flow";
import { createClient } from "@/utils/supabase/client";

type InvitePreview = {
  valid: boolean;
  email?: string;
  role?: string;
  tenant_name?: string;
};

export function PortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const invite = searchParams.get("invite");

  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [staffBlocked, setStaffBlocked] = useState(false);
  const [staffRedirecting, setStaffRedirecting] = useState(false);

  useEffect(() => {
    setError(searchParams.get("error"));
  }, [searchParams]);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setSignedInEmail(user?.email ?? null);
      if (!user) {
        setStaffBlocked(false);
        return;
      }

      if (invite) return;

      try {
        const access = await getStaffAccess(supabase, user);
        if (access.canEnterPortal) {
          setStaffRedirecting(true);
          const target = await resolvePortalLoginPath(supabase, user, { next });
          router.replace(target);
          return;
        }
        setStaffBlocked(true);
      } catch {
        setStaffBlocked(true);
      }
    })();
  }, [invite, next, router]);

  useEffect(() => {
    if (!invite) return;
    const supabase = createClient();
    void supabase.rpc("get_staff_invite_preview", { p_token: invite }).then(({ data }) => {
      const preview = data as InvitePreview | null;
      if (preview?.valid && preview.email) {
        setInvitePreview(preview);
        setEmail(preview.email);
        setMode("signup");
      }
    });
  }, [invite]);

  async function afterSignIn() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign-in failed");

    const target = await resolvePortalLoginPath(supabase, user, {
      next: isLegacyDefaultNext(next) ? null : next,
      inviteToken: invite,
    });
    router.push(target);
    router.refresh();
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      clearAuthSessionStorage();
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      await afterSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    if (!invite) {
      setError("Staff accounts require an invitation from CodexOne.");
      return;
    }
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
      await afterSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed.");
    } finally {
      setLoading(false);
    }
  }

  const roleLabel =
    invitePreview?.role === "global_admin"
      ? "CodexOne administrator"
      : invitePreview?.tenant_name
        ? `${invitePreview.tenant_name} advisor`
        : "Fractals advisor";

  return (
    <AuthFormShell
      title="Staff portal"
      subtitle="Sign in as CodexOne or your firm (Randall). Invitation required for new accounts."
      footer={
        <div className="auth-switch mt-6 space-y-2 text-center text-sm">
          <p>
            End client?{" "}
            <Link href={CLIENT_LOGIN} className="auth-switch-link">
              Client login
            </Link>
          </p>
          {invite && mode === "signin" && (
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => setMode("signup")}
            >
              Accept invite — create account
            </button>
          )}
        </div>
      }
    >
      {invitePreview?.valid && (
        <div className="auth-alert auth-alert-success mb-4 text-sm">
          Invited as <strong>{roleLabel}</strong>
          {invitePreview.email ? ` · ${invitePreview.email}` : ""}
        </div>
      )}

      {invite && signedInEmail && invitePreview?.email && signedInEmail.toLowerCase() !== invitePreview.email.toLowerCase() && (
        <div className="auth-alert auth-alert-error mb-4 text-sm">
          Signed in as <strong>{signedInEmail}</strong>. Sign out to accept this invite as{" "}
          <strong>{invitePreview.email}</strong>.
          <div className="mt-3">
            <SignOutButton className="text-red-800 underline" />
          </div>
        </div>
      )}

      {error && <div className="auth-alert auth-alert-error">{error}</div>}

      {staffRedirecting && (
        <p className="text-sm text-center text-codex-muted mb-4">Redirecting to your console…</p>
      )}

      {staffBlocked && signedInEmail && !invite && (
        <div className="auth-alert auth-alert-error mb-4 text-sm">
          <p>
            <strong>{signedInEmail}</strong> has no staff access. Portal accounts require a
            CodexOne invite or an <code>@codexone.io</code> email.
          </p>
          <div className="mt-3 flex flex-col gap-2 items-center">
            <SignOutButton className="text-red-800 underline" />
            <Link href={CLIENT_LOGIN} className="text-oxford underline text-sm">
              Looking for client modules?
            </Link>
          </div>
        </div>
      )}

      {!staffBlocked && !staffRedirecting && (
        <>
      <GoogleSignInButton
        flow="portal"
        nextPath={isLegacyDefaultNext(next) ? undefined : (next ?? undefined)}
        invite={invite ?? undefined}
        disabled={loading}
        label="Continue with Google"
      />

      <div className="auth-divider">
        <span />
        <p>or</p>
        <span />
      </div>

      <form
        onSubmit={mode === "signup" ? handleSignUp : handleSignIn}
        className="auth-form"
      >
        {mode === "signup" && (
          <>
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
          </>
        )}

        <label className="auth-label" htmlFor="email">
          Work email
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />

        <button className="auth-btn-primary" type="submit" disabled={loading}>
          {loading
            ? "Working…"
            : mode === "signup"
              ? "Create staff account"
              : "Sign in"}
        </button>
      </form>

      {!invite && (
        <p className="text-xs text-center text-slate-500 mt-4">
          New staff accounts are invite-only. @codexone.io users with existing access may sign in directly.
        </p>
      )}
        </>
      )}
    </AuthFormShell>
  );
}
