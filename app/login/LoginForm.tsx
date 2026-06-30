"use client";

import { FormEvent, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { clearAuthSessionStorage } from "@/lib/auth/oauth";
import { afterAuthBootstrap } from "@/lib/auth/rbac";
import { parseFfLoginRoute } from "@/lib/ff/routing";
import { createClient } from "@/utils/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [hashError, setHashError] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  useEffect(() => {
    setCallbackError(searchParams.get("error"));
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const description = params.get("error_description");
    if (description) {
      setHashError(decodeURIComponent(description.replace(/\+/g, " ")));
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (callbackError) {
      setError(callbackError);
    } else if (hashError) {
      setError(hashError);
    }
  }, [hashError, callbackError]);

  const handleSubmit = async (e: FormEvent) => {
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

      if (user) {
        await afterAuthBootstrap(supabase, user);
      }

      let target = next;
      if (!target || target === "/switchboard") {
        const { data: routeData } = await supabase.rpc("get_ff_login_route");
        target = parseFfLoginRoute(routeData).route;
      }

      router.push(target);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <Link href="/" className="auth-back">
        ← Back
      </Link>

      <div className="auth-card">
        <h1 className="auth-title">Enter the Airlock</h1>
        <p className="text-center text-sm text-slate-600 mb-6">
          Sign in to access your vaults.
        </p>

        {error && <div className="auth-alert auth-alert-error">{error}</div>}

        <GoogleSignInButton nextPath={next ?? undefined} disabled={loading} />

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
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label className="auth-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="auth-input"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button
            className="auth-btn-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in with email"}
          </button>
        </form>

        <div className="auth-switch">
          No account?{" "}
          <Link href="/signup" className="auth-switch-link">
            Create one
          </Link>
        </div>
      </div>
    </main>
  );
}
