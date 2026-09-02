import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_LOGIN } from "@/lib/auth/login-flow";
import { getTier } from "@/lib/auth/rbac";
import {
  resolveModuleTheme,
  resolveModuleThemeFromRpcPayload,
  themeToAppOverrideBlock,
} from "@/lib/branding/resolve-theme";
import { ClientGrantsProvider } from "@/components/platform/ClientGrantsContext";
import { ClientShellFrame } from "@/components/platform/ClientShellFrame";
import { BcnThemeProvider } from "@/components/bcn/BcnThemeContext";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import type { Database } from "@/lib/database.types";
import "@/app/styles/continuity.css";
import "@/app/styles/summit-r1.css";

export default async function ClientShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`${CLIENT_LOGIN}?next=/client`);

  const tier = await getTier(supabase, user.id);

  const { data: grants } = await supabase
    .from("client_module_access")
    .select(
      "id, module_id, distributor_tenant_id, vault_id, status, modules(slug, name, route_base), tenants(name, branding, brand_color_hex)"
    )
    .eq("client_user_id", user.id)
    .eq("status", "active");

  const grantList = grants ?? [];

  // Spec B10 — suspended/revoked: no active grant → blocked shell (RLS also denies).
  if (grantList.length === 0) {
    const { data: blocked } = await supabase
      .from("client_module_access")
      .select("id, status, modules(slug), tenants(name)")
      .eq("client_user_id", user.id)
      .in("status", ["suspended", "revoked"])
      .limit(5);

    const treasuryBlocked = (blocked ?? []).find((g) => {
      const mod = g.modules as { slug?: string } | null;
      return mod?.slug === "treasury";
    });

    if (treasuryBlocked) {
      const tenant = treasuryBlocked.tenants as { name?: string } | null;
      const status = treasuryBlocked.status;
      return (
        <div className="client-wrap p-8 max-w-lg mx-auto">
          <p className="eyebrow">Access</p>
          <h1 className="sec-title">
            {status === "suspended" ? "Access paused" : "Access ended"}
          </h1>
          <p className="treasury-meta mt-2">
            {status === "suspended"
              ? `Your Summit Treasury access with ${tenant?.name ?? "your advisor"} is paused. Contact them if you need it restored.`
              : `Your Summit Treasury access with ${tenant?.name ?? "your advisor"} has ended.`}
          </p>
        </div>
      );
    }

    if (tier !== "client" && tier !== "global_admin") {
      redirect(`${CLIENT_LOGIN}?next=/client`);
    }
  }

  if (
    tier !== "client" &&
    tier !== "global_admin" &&
    grantList.length === 0
  ) {
    redirect(`${CLIENT_LOGIN}?next=/client`);
  }

  const cookieStore = await cookies();
  const activeGrantId = cookieStore.get("active_grant_id")?.value;

  const active =
    grantList.find((g) => g.id === activeGrantId) ?? grantList[0] ?? null;

  const tenant = active?.tenants as {
    name: string;
    branding: unknown;
    brand_color_hex: string | null;
  } | null;

  const moduleMeta = active?.modules as { slug: string; name: string } | null;

  // IMPORTANT: client users generally cannot read operator_modules via RLS.
  // Use the security-definer RPC so module branding reliably reaches clients.
  let theme = resolveModuleTheme(
    {
      name: tenant?.name ?? "Fractals",
      branding: (tenant?.branding ??
        {}) as Database["public"]["Tables"]["tenants"]["Row"]["branding"],
      brand_color_hex: tenant?.brand_color_hex ?? null,
    },
    { branding: {}, logo_url: null },
    moduleMeta?.name
  );

  if (active?.id) {
    const { data: payload, error: payloadErr } = await supabase.rpc(
      "get_client_module_branding",
      { p_grant_id: active.id }
    );
    if (!payloadErr && payload && typeof payload === "object") {
      theme = resolveModuleThemeFromRpcPayload(
        payload as unknown as Parameters<
          typeof resolveModuleThemeFromRpcPayload
        >[0]
      );
    }
  }

  if (moduleMeta?.slug === "treasury") {
    theme = {
      ...theme,
      dataBrand: "summit",
      wordmark: defaultWordmark("summit"),
    };
  }

  return (
    <ClientGrantsProvider grants={grantList} activeGrantId={active?.id}>
      <BcnThemeProvider theme={theme}>
        <ClientShellFrame
          styleBlock={themeToAppOverrideBlock(theme.dataBrand, theme.tokenOverrides)}
          dataBrand={theme.dataBrand}
          tenantId={active?.distributor_tenant_id ?? ""}
          tenantName={tenant?.name ?? "Your modules"}
          grants={grantList}
          activeGrantId={active?.id}
        >
          {children}
        </ClientShellFrame>
      </BcnThemeProvider>
    </ClientGrantsProvider>
  );
}
