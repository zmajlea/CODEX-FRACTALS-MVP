import Link from "next/link";

export default function LoginChooserPage() {
  return (
    <main className="auth-page">
      <Link href="/" className="auth-back">
        ← Back
      </Link>

      <div className="auth-card">
        <h1 className="auth-title">Sign in</h1>
        <p className="text-center text-sm text-slate-600 mb-8">
          Choose how you use Fractals.
        </p>

        <div className="space-y-4">
          <Link
            href="/portal/login"
            className="block w-full text-center auth-btn-primary py-3"
          >
            Staff portal
          </Link>
          <p className="text-xs text-center text-slate-500">
            CodexOne administrators and Operator firm advisors (Randall). Invite required for new accounts.
          </p>

          <div className="auth-divider">
            <span />
            <p>or</p>
            <span />
          </div>

          <Link
            href="/client/login"
            className="block w-full text-center auth-btn-google py-3"
          >
            Client login
          </Link>
          <p className="text-xs text-center text-slate-500">
            End clients — create an account or use your advisor&apos;s invite link.
          </p>
        </div>
      </div>
    </main>
  );
}
