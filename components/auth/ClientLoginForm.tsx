"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { AuthFormShell } from "@/components/auth/AuthFormShell";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";
import {
  CLIENT_SIGNUP,
  isLegacyDefaultNext,
  PORTAL_LOGIN,
  resolveClientLoginPath,
} from "@/lib/auth/login-flow";
import { getTier } from "@/lib/auth/rbac";
import { createClient } from "@/utils/supabase/client";

type InvitePreview = {
  valid: boolean;
  email?: string;
  tenant_name?: string;
  module_name?: string;
};

export function ClientLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const invite = searchParams.get("invite");

  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDistributorAccount, setIsDistributorAccount] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [clientRedirecting, setClientRedirecting] = useState(false);

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
        setIsDistributorAccount(false);
        return;
      }

      const tier = await getTier(supabase, user.id);
      if (tier === "operator") {
        setIsDistributorAccount(true);
        return;
      }

      if (invite) return;

      try {
        const target = await resolveClientLoginPath(supabase, user, {
          next: isLegacyDefaultNext(next) ? null : next,
        });
        if (target.startsWith("/client/") && target !== "/client/login") {
          setClientRedirecting(true);
          router.replace(target);
        }
      } catch {
        /* stay on login */
      }
    })();
  }, [invite, next, router]);

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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign-in failed");

      const target = await resolveClientLoginPath(supabase, user, {
        next: isLegacyDefaultNext(next) ? null : next,
        inviteToken: invite,
      });

      router.push(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  const signupHref = invite
    ? `${CLIENT_SIGNUP}?invite=${encodeURIComponent(invite)}`
    : CLIENT_SIGNUP;

  return (
    <AuthFormShell
      title="Client access"
      subtitle="Sign in to your continuity modules. New here? Create a free account."
      footer={
        <div className="auth-switch mt-6 space-y-2 text-center text-sm">
          <p>
            No account?{" "}
            <Link href={signupHref} className="auth-switch-link">
              Create client account
            </Link>
          </p>
          <p>
            Operator or CodexOne staff?{" "}
            <Link href={PORTAL_LOGIN} className="auth-switch-link">
              Staff portal
            </Link>
          </p>
        </div>
      }
    >
      {invitePreview?.valid && (
        <div className="auth-alert auth-alert-success mb-4 text-sm">
          {invitePreview.tenant_name ? (
            <>
              <strong>{invitePreview.tenant_name}</strong> invited you to{" "}
              <strong>{invitePreview.module_name ?? "your module"}</strong>
            </>
          ) : (
            <>You have a pending module invite</>
          )}
          {invitePreview.email ? ` · use ${invitePreview.email}` : ""}
        </div>
      )}

      {clientRedirecting && (
        <p className="text-sm text-center text-codex-muted mb-4">Opening your module…</p>
      )}

      {isDistributorAccount && (
        <div className="auth-alert auth-alert-error mb-4 text-sm">
          <p>
            <strong>{signedInEmail}</strong> is a Operator advisor account, not a client seat. Use the{" "}
            <Link href="/operator" className="underline font-medium">
              operator console
            </Link>{" "}
            or{" "}
            <Link href={PORTAL_LOGIN} className="underline font-medium">
              staff portal
            </Link>
            . To test the client experience, provision a seat for a <em>different</em> email.
          </p>
          <div className="mt-3">
            <SignOutButton className="text-red-800 underline" />
          </div>
        </div>
      )}

      {error && <div className="auth-alert auth-alert-error">{error}</div>}

      {!isDistributorAccount && !clientRedirecting && (
        <>
      <GoogleSignInButton
        flow="client"
        nextPath={isLegacyDefaultNext(next) ? undefined : (next ?? undefined)}
        invite={invite ?? undefined}
        disabled={loading}
      />

      <div className="auth-divider">
        <span />
        <p>or</p>
        <span />
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="auth-btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
        </>
      )}
    </AuthFormShell>
  );
}
