import { Suspense } from "react";
import { BcnWizardModule } from "@/components/bcn/BcnWizardModule";

export default function ClientBcnPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading BCN module…</p>}>
      <BcnWizardModule />
    </Suspense>
  );
}
