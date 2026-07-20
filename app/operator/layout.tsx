import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PORTAL_LOGIN } from "@/lib/auth/login-flow";
import { getPrimaryOperatorTenantId, requireTier } from "@/lib/auth/rbac";
import {
  resolveTenantTheme,
  themeToStyleBlock,
} from "@/lib/branding/resolve-theme";
import { BcnThemeProvider } from "@/components/bcn/BcnThemeContext";
import type { Database } from "@/lib/database.types";
import "@/app/styles/continuity.css";
import "@/app/styles/summit-r1.css";

export default async function OperatorLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${PORTAL_LOGIN}?next=/operator`);

  await requireTier(supabase, user.id, ["operator", "global_admin"]);

  const tenantId = await getPrimaryOperatorTenantId(supabase, user.id);

  let theme = resolveTenantTheme({
    name: "Fractals",
    branding: {},
    brand_color_hex: null,
  });

  if (tenantId) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, branding, brand_color_hex, logo_url")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenant) {
      theme = resolveTenantTheme({
        name: tenant.name,
        branding:
          tenant.branding as Database["public"]["Tables"]["tenants"]["Row"]["branding"],
        brand_color_hex: tenant.brand_color_hex,
        logo_url: tenant.logo_url,
      });
    }
  }

  return (
    <BcnThemeProvider theme={theme}>
      <style>{themeToStyleBlock(theme)}</style>
      {children}
    </BcnThemeProvider>
  );
}
