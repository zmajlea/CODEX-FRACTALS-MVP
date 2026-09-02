import { Suspense } from "react";
import { ActivateClientForm } from "@/components/portal/ActivateClientForm";

export default function PortalActivatePage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "#eef3f9", color: "#102a47" }}
      data-brand="summit"
    >
      <div
        className="w-full max-w-lg rounded-lg p-6 shadow-sm"
        style={{ background: "#fff", border: "1px solid #c5d0dc" }}
      >
        <p
          className="text-xs uppercase tracking-widest mb-4"
          style={{ color: "#174a7a" }}
        >
          Summit Treasury
        </p>
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <ActivateClientForm />
        </Suspense>
      </div>
    </main>
  );
}
