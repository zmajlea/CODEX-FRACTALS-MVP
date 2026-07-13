import type { BrandingTokens } from "@/lib/branding/resolve-theme";
import type { EmailBranding } from "@/lib/email/types";

const DEFAULT_ACCENT = "#8A1E1A";

export function emailBrandingFromTokens(
  theme: BrandingTokens,
  options?: { firmName?: string; brandColorHex?: string | null }
): EmailBranding {
  return {
    wordmark: theme.wordmark ?? "Business Continuity Navigator",
    logoUrl: theme.logoUrl,
    brandColorHex: options?.brandColorHex?.trim() || DEFAULT_ACCENT,
    firmName: options?.firmName,
  };
}

export function emailBrandingFromTenant(input: {
  name: string;
  logo_url?: string | null;
  brand_color_hex?: string | null;
  wordmark?: string | null;
}): EmailBranding {
  return {
    wordmark: input.wordmark?.trim() || input.name,
    logoUrl: input.logo_url ?? null,
    brandColorHex: input.brand_color_hex?.trim() || DEFAULT_ACCENT,
    firmName: input.name,
  };
}
