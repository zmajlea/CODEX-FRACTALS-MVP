import type { Database } from "@/lib/database.types";

export type BrandingTokens = {
  dataBrand: string;
  cssVars: Record<string, string>;
};

const HOUSE_DEFAULTS: Record<string, string> = {
  "--vellum": "#FCFBF9",
  "--obsidian": "#1A1A1B",
  "--oxford": "#2C3E50",
  "--amber": "#EBC06D",
  "--bone": "#DED9D1",
  "--cinnabar": "#E67E50",
  "--cinnabar-deep": "#E67E50",
  "--ink": "#1A1A1B",
};

export function resolveThemeFromBranding(
  branding: Record<string, unknown> | null | undefined,
  fallbackColor?: string | null
): BrandingTokens {
  const b = branding ?? {};
  const dataBrand =
    typeof b["data-brand"] === "string" ? (b["data-brand"] as string) : "ff3";

  const cssVars: Record<string, string> = { ...HOUSE_DEFAULTS };

  for (const [key, value] of Object.entries(b)) {
    if (typeof value === "string" && key.startsWith("--")) {
      cssVars[key] = value;
    }
  }

  if (fallbackColor) {
    cssVars["--cinnabar"] = fallbackColor;
    cssVars["--cinnabar-deep"] = fallbackColor;
  }

  if (typeof b["--cinnabar"] === "string") {
    cssVars["--cinnabar"] = b["--cinnabar"] as string;
    cssVars["--cinnabar-deep"] = b["--cinnabar"] as string;
  }

  return { dataBrand, cssVars };
}

export function themeToStyleBlock(theme: BrandingTokens): string {
  const lines = Object.entries(theme.cssVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n  ");
  return `:root {\n  ${lines}\n}`;
}

export type TenantBrandingRow = {
  branding: Database["public"]["Tables"]["tenants"]["Row"]["branding"];
  brand_color_hex: string | null;
  name: string;
};

export function resolveTenantTheme(tenant: TenantBrandingRow): BrandingTokens {
  const branding =
    tenant.branding && typeof tenant.branding === "object" && !Array.isArray(tenant.branding)
      ? (tenant.branding as Record<string, unknown>)
      : {};
  return resolveThemeFromBranding(branding, tenant.brand_color_hex);
}
