import { Suspense } from "react";
import { ContinuityWizard } from "@/components/ff/ContinuityWizard";

type Props = {
  params: Promise<{ domain: string }>;
};

export default async function TenantWizardPage({ params }: Props) {
  const { domain } = await params;

  return (
    <Suspense
      fallback={
        <p className="px-6 py-12 text-sm text-codex-muted">Loading wizard…</p>
      }
    >
      <ContinuityWizard domain={domain} />
    </Suspense>
  );
}
