import { Suspense } from "react";
import { ClientSignupForm } from "@/components/auth/ClientSignupForm";

export default function ClientSignupPage() {
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
      <ClientSignupForm />
    </Suspense>
  );
}
