import { Suspense } from "react";
import { ClientLoginForm } from "@/components/auth/ClientLoginForm";

export default function ClientLoginPage() {
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
      <ClientLoginForm />
    </Suspense>
  );
}
