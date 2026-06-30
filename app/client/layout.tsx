import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { requireTier } from "@/lib/auth/rbac";
import {
  resolveTenantTheme,
  themeToStyleBlock,
} from "@/lib/branding/resolve-theme";
import { ModuleSelector } from "@/components/platform/ModuleSelector";
import type { Database } from "@/lib/database.types";
import "@/app/styles/continuity.css";

export default async function ClientLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/client");

  await requireTier(supabase, user.id, ["client", "global_admin"]);

  const cookieStore = await cookies();
  const activeGrantId = cookieStore.get("active_grant_id")?.value;

  const { data: grants } = await supabase
    .from("client_module_access")
    .select(
      "id, module_id, distributor_tenant_id, modules(slug, name, route_base), tenants(name, branding, brand_color_hex)"
    )
    .eq("client_user_id", user.id)
    .eq("status", "active");

  const grantList = grants ?? [];
  const active =
    grantList.find((g) => g.id === activeGrantId) ?? grantList[0] ?? null;

  const tenant = active?.tenants as {
    name: string;
    branding: unknown;
    brand_color_hex: string | null;
  } | null;

  const theme = resolveTenantTheme({
    name: tenant?.name ?? "Fractals",
    branding: (tenant?.branding ?? {}) as Database["public"]["Tables"]["tenants"]["Row"]["branding"],
    brand_color_hex: tenant?.brand_color_hex ?? null,
  });

  return (
    <div
      className="app cs min-h-screen"
      data-brand={theme.dataBrand}
      data-ff-tenant={active?.distributor_tenant_id ?? ""}
    >
      <style>{themeToStyleBlock(theme)}</style>
      <header className="topbar appbar border-b border-bone px-6 py-3 flex items-center justify-between">
        <span className="font-head">{tenant?.name ?? "Your modules"}</span>
        <ModuleSelector grants={grantList} activeGrantId={active?.id} />
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
