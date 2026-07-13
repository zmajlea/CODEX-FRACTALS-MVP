import type { Database } from "@/lib/database.types";
import {
  MODULE_ACTIVE_CUSTOM,
  parseCustomSlotFromBranding,
  parseOverridesFromRecord,
} from "@/lib/branding/custom-tokens";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";

/** Continuity.css white-label presets (product-build-v2). */
export const BRAND_PRESETS = [
  "bcn1",
  "bcn2",
  "bcn3",
  "bcn4",
  "fractals",
  "summit",
] as const;

export type BrandPreset = (typeof BRAND_PRESETS)[number];

export type BrandingTokens = {
  dataBrand: string;
  cssVars: Record<string, string>;
  /** Custom --token overrides saved in branding JSON (applied on #app). */
  tokenOverrides: Record<string, string>;
  logoUrl: string | null;
  wordmark: string | null;
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

const DEFAULT_WORDMARK = "Business Continuity Navigator";

function asBrandingRecord(
  value: unknown
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickPreset(branding: Record<string, unknown>): string {
  const raw = branding["data-brand"];
  if (raw === MODULE_ACTIVE_CUSTOM) {
    const custom = asBrandingRecord(branding.custom);
    const base = custom.base;
    if (typeof base === "string" && BRAND_PRESETS.includes(base as BrandPreset)) {
      return base;
    }
    return "bcn3";
  }
  if (typeof raw === "string" && BRAND_PRESETS.includes(raw as BrandPreset)) {
    return raw;
  }
  return "bcn3";
}

function isCustomActive(branding: Record<string, unknown>): boolean {
  return branding["data-brand"] === MODULE_ACTIVE_CUSTOM;
}

function brandingSourceForResolve(
  branding: Record<string, unknown>
): Record<string, unknown> {
  if (!isCustomActive(branding)) {
    return { "data-brand": branding["data-brand"] ?? "bcn3" };
  }
  const custom = asBrandingRecord(branding.custom);
  return {
    "data-brand": pickPreset(branding),
    wordmark: custom.wordmark,
    ...parseOverridesFromRecord(custom),
  };
}

function pickWordmark(
  branding: Record<string, unknown>,
  fallbacks: Array<string | null | undefined>
): string | null {
  const fromBranding = branding.wordmark;
  if (typeof fromBranding === "string" && fromBranding.trim()) {
    return fromBranding.trim();
  }
  for (const candidate of fallbacks) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

export function resolveThemeFromBranding(
  branding: Record<string, unknown> | null | undefined,
  fallbackColor?: string | null,
  options?: { logoUrl?: string | null; wordmark?: string | null; forceLogo?: boolean }
): BrandingTokens {
  const b = branding ?? {};
  const customActive = isCustomActive(b);
  const source = brandingSourceForResolve(b);
  const dataBrand = pickPreset(b);
  const tokenOverrides: Record<string, string> = {};

  const cssVars: Record<string, string> = { ...HOUSE_DEFAULTS };

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && key.startsWith("--")) {
      tokenOverrides[key] = value;
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

  if (typeof b["--brand"] === "string") {
    cssVars["--brand"] = b["--brand"] as string;
  }

  const wordmark =
    options?.wordmark ??
    pickWordmark(source, [typeof source.wordmark === "string" ? source.wordmark : null]);

  const logoUrl =
    customActive || options?.forceLogo ? (options?.logoUrl ?? null) : null;

  return {
    dataBrand,
    cssVars,
    tokenOverrides,
    logoUrl,
    wordmark,
  };
}

export function themeToStyleBlock(theme: BrandingTokens): string {
  const lines = Object.entries(theme.cssVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n  ");
  return `:root {\n  ${lines}\n}`;
}

/** Scoped preview styles for the operator branding wizard (avoids leaking :root). */
export function themeToScopedStyleBlock(
  dataBrand: string,
  branding: Record<string, unknown>
): string {
  const lines = Object.entries(branding)
    .filter(([k, v]) => k.startsWith("--") && typeof v === "string" && v.trim())
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n  ");

  if (!lines) return "";
  return `.branding-preview-scope[data-brand="${dataBrand}"] {\n  ${lines}\n}`;
}

/** Apply Operator token overrides on the continuity #app shell (beats preset block). */
export function themeToAppOverrideBlock(
  dataBrand: string,
  overrides: Record<string, string>
): string {
  const lines = Object.entries(overrides)
    .filter(([k, v]) => k.startsWith("--") && v.trim())
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n  ");
  if (!lines) return "";
  return `#app[data-brand="${dataBrand}"] {\n  ${lines}\n}`;
}

export function tokenOverridesToStyle(
  overrides: Record<string, string>
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith("--") && value.trim()) {
      style[key] = value;
    }
  }
  return style;
}

export function resolvePreviewTheme(
  preset: BrandPreset,
  wordmark: string,
  overrides: Record<string, string>,
  logoUrl?: string | null,
  options?: { isCustom?: boolean }
): BrandingTokens {
  const branding: Record<string, unknown> = options?.isCustom
    ? {
        "data-brand": MODULE_ACTIVE_CUSTOM,
        custom: { base: preset, wordmark, logo_url: logoUrl ?? undefined, ...overrides },
        wordmark,
        ...overrides,
      }
    : { "data-brand": preset, wordmark, ...overrides };

  return resolveThemeFromBranding(branding, null, {
    logoUrl: logoUrl ?? null,
    wordmark,
    forceLogo: options?.isCustom,
  });
}

export type TenantBrandingRow = {
  branding: Database["public"]["Tables"]["tenants"]["Row"]["branding"];
  brand_color_hex: string | null;
  name: string;
  logo_url?: string | null;
};

export type ModuleBrandingRow = {
  branding?: Database["public"]["Tables"]["operator_modules"]["Row"]["branding"];
  logo_url?: string | null;
};

/** RPC payload shape from get_client_module_branding. */
export type ClientModuleBrandingPayload = {
  grant_id: string;
  module_slug: string;
  module_name: string;
  tenant_id: string;
  tenant_name: string;
  tenant_branding: Record<string, unknown>;
  tenant_logo_url: string | null;
  tenant_brand_color_hex: string | null;
  module_branding: Record<string, unknown>;
  module_logo_url: string | null;
};

export function mergeModuleBranding(
  tenant: TenantBrandingRow,
  module: ModuleBrandingRow
): Record<string, unknown> {
  const tenantBranding = asBrandingRecord(tenant.branding);
  const moduleBranding = asBrandingRecord(module.branding);
  return { ...tenantBranding, ...moduleBranding };
}

/**
 * Module branding overrides tenant defaults (logo, preset, accent, wordmark).
 * Used by client and operator continuity shells once UI is wired in Phase B+.
 */
export function resolveModuleTheme(
  tenant: TenantBrandingRow,
  module: ModuleBrandingRow,
  moduleName?: string | null
): BrandingTokens {
  const merged = mergeModuleBranding(tenant, module);
  const customActive = isCustomActive(merged);
  const customSlot = parseCustomSlotFromBranding(merged, module.logo_url);
  const activePreset = pickPreset(merged) as BrandPreset;
  const logoUrl = customActive ? customSlot.logoUrl || module.logo_url || null : null;
  const wordmark = customActive
    ? customSlot.wordmark
    : defaultWordmark(activePreset);

  return resolveThemeFromBranding(merged, tenant.brand_color_hex, {
    logoUrl,
    wordmark,
  });
}

export function resolveTenantTheme(tenant: TenantBrandingRow): BrandingTokens {
  const branding = asBrandingRecord(tenant.branding);
  return resolveThemeFromBranding(branding, tenant.brand_color_hex, {
    logoUrl: tenant.logo_url ?? null,
    wordmark: pickWordmark(branding, [tenant.name, DEFAULT_WORDMARK]),
  });
}

export function resolveModuleThemeFromRpcPayload(
  payload: ClientModuleBrandingPayload
): BrandingTokens {
  return resolveModuleTheme(
    {
      name: payload.tenant_name,
      branding: payload.tenant_branding as TenantBrandingRow["branding"],
      brand_color_hex: payload.tenant_brand_color_hex,
      logo_url: payload.tenant_logo_url,
    },
    {
      branding: payload.module_branding as ModuleBrandingRow["branding"],
      logo_url: payload.module_logo_url,
    },
    payload.module_name
  );
}
