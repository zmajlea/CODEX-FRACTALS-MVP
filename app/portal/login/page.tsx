import { Suspense } from "react";
import { PortalLoginForm } from "@/components/auth/PortalLoginForm";

export default function PortalLoginPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <div className="auth-card">
            <p className="text-center text-sm text-slate-600">Loading…</p>
          </div>
        </main>
      }
    >
      <PortalLoginForm />
    </Suspense>
  );
}
