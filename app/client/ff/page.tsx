import { Suspense } from "react";
import { FfWizardModule } from "@/components/ff/FfWizardModule";

export default function ClientFfPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading FF module…</p>}>
      <FfWizardModule />
    </Suspense>
  );
}
