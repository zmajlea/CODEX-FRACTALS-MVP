/**
 * FF module theme — re-exports branding resolution for continuity shells.
 * @see lib/branding/resolve-theme.ts
 */
export {
  BRAND_PRESETS,
  mergeModuleBranding,
  resolveModuleTheme,
  resolveModuleThemeFromRpcPayload,
  type BrandPreset,
  type BrandingTokens,
  type ClientModuleBrandingPayload,
  type ModuleBrandingRow,
  type TenantBrandingRow,
} from "@/lib/branding/resolve-theme";
