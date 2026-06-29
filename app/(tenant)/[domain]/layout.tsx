import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTenantByDomain } from "@/lib/ff/tenant";
import { FfTopbar } from "@/components/ff/FfTopbar";
import "@/app/ff/ff-v1.css";

type Props = {
  children: ReactNode;
  params: Promise<{ domain: string }>;
};

export default async function TenantLayout({ children, params }: Props) {
  const { domain } = await params;
  const tenant = await getTenantByDomain(domain);

  if (!tenant) {
    notFound();
  }

  const accent = tenant.brand_color_hex ?? "#E67E50";

  return (
    <div className="ff-shell min-h-screen" data-ff-tenant={tenant.domain_slug}>
      <style>{`:root { --cinnabar: ${accent}; --brand: ${accent}; --cinnabar-deep: ${accent}; }`}</style>
      <FfTopbar
        name={tenant.name}
        logoUrl={tenant.logo_url}
        domain={tenant.domain_slug}
      />
      <main className="ff-main">{children}</main>
    </div>
  );
}
