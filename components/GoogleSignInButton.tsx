"use client";

import { useState } from "react";
import { startGoogleSignIn } from "@/lib/auth/oauth";

type GoogleSignInButtonProps = {
  nextPath?: string;
  disabled?: boolean;
  label?: string;
};

export default function GoogleSignInButton({
  nextPath = "/switchboard",
  disabled = false,
  label = "Continue with Google",
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    setLoading(true);
    try {
      startGoogleSignIn(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      {error && (
        <div className="auth-alert auth-alert-error mb-3">{error}</div>
      )}
      <button
        type="button"
        className="auth-btn-google"
        onClick={handleClick}
        disabled={disabled || loading}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.56 2.95-2.23 5.45-4.64 7.15l7.98 6.19C43.98 37.03 46.98 31.28 46.98 24.55z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.98-6.19c-2.18 1.45-4.98 2.3-7.91 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
        {loading ? "Connecting to Google…" : label}
      </button>
    </div>
  );
}
