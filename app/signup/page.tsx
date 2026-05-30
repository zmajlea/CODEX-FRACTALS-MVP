"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { createClient } from "@/utils/supabase/client";

export default function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim() },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      setSuccess(
        "Account created. Check your email if confirmation is required, then sign in."
      );
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("Signup failed. Please try again.");
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
        <h1 className="auth-title">Create Account</h1>

        {error && <div className="auth-alert auth-alert-error">{error}</div>}
        {success && (
          <div className="auth-alert auth-alert-success">{success}</div>
        )}

        <GoogleSignInButton
          label="Sign up with Google"
          disabled={loading}
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
            type="text"
            placeholder="Ada Lovelace"
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
            placeholder="Minimum 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />

          <button
            className="auth-btn-primary"
            type="submit"
            disabled={loading}
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          Already have an account?{" "}
          <Link href="/login" className="auth-switch-link">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
