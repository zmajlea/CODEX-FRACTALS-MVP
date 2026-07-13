import type { BrandPreset } from "@/lib/branding/resolve-theme";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";

/** Semantic tokens operators may override on top of a base preset skin. */
export const BRANDING_OVERRIDE_KEYS = [
  "--brand",
  "--brand-2",
  "--seal",
  "--foil",
  "--canvas",
  "--paper",
  "--ink",
] as const;

export type BrandingOverrideKey = (typeof BRANDING_OVERRIDE_KEYS)[number];

export type BrandingOverrides = Partial<Record<BrandingOverrideKey, string>>;

export const BRANDING_OVERRIDE_LABELS: Record<BrandingOverrideKey, string> = {
  "--brand": "Primary brand",
  "--brand-2": "Secondary accent",
  "--seal": "Seal color",
  "--foil": "Foil / highlight",
  "--canvas": "Background canvas",
  "--paper": "Paper surface",
  "--ink": "Body text",
};

/** Operator picker: the three BCN continuity skins operators can revert to. */
export const OPERATOR_BASE_PRESETS: BrandPreset[] = ["bcn1", "bcn2", "bcn3"];

/** @deprecated use OPERATOR_BASE_PRESETS */
export const CPA_BASE_PRESETS = OPERATOR_BASE_PRESETS;

export const MODULE_ACTIVE_CUSTOM = "custom" as const;

export type ModuleActiveBrand = BrandPreset | typeof MODULE_ACTIVE_CUSTOM;

export const PRESET_LABELS: Record<BrandPreset, string> = {
  bcn1: "Fiduciary Ledger",
  bcn2: "Engine House",
  bcn3: "Heritage Ledger",
  bcn4: "Firehouse",
  fractals: "Fractals platform",
  summit: "Summit Treasury",
};

/** Persisted custom slot (survives switching back to bcn1–bcn3). */
export type CustomBrandingSlot = {
  base: BrandPreset;
  wordmark: string;
  logoUrl: string;
  overrides: BrandingOverrides;
};

export type ModuleBrandingState = {
  active: ModuleActiveBrand;
  custom: CustomBrandingSlot;
};

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export function isValidHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

function isCpaBasePreset(value: string): value is BrandPreset {
  return (OPERATOR_BASE_PRESETS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function emptyCustomSlot(base: BrandPreset = "bcn3"): CustomBrandingSlot {
  return {
    base,
    wordmark: defaultWordmark(base),
    logoUrl: "",
    overrides: {},
  };
}

export function parseOverridesFromRecord(
  record: Record<string, unknown> | null | undefined
): BrandingOverrides {
  const out: BrandingOverrides = {};
  if (!record) return out;
  for (const key of BRANDING_OVERRIDE_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      out[key] = raw.trim();
    }
  }
  return out;
}

/** @deprecated use parseOverridesFromRecord */
export function parseOverridesFromBranding(
  branding: Record<string, unknown> | null | undefined
): BrandingOverrides {
  return parseOverridesFromRecord(branding);
}

export function parseCustomSlotFromBranding(
  branding: Record<string, unknown> | null | undefined,
  moduleLogoUrl?: string | null
): CustomBrandingSlot {
  const b = branding ?? {};
  const nested = asRecord(b.custom);

  const baseRaw = nested.base ?? b["data-brand"];
  const base =
    typeof baseRaw === "string" && isCpaBasePreset(baseRaw) ? baseRaw : "bcn3";

  const wordmarkRaw = nested.wordmark ?? b.wordmark;
  const wordmark =
    typeof wordmarkRaw === "string" && wordmarkRaw.trim()
      ? wordmarkRaw.trim()
      : defaultWordmark(base);

  const logoRaw = nested.logo_url ?? moduleLogoUrl;
  const logoUrl = typeof logoRaw === "string" ? logoRaw.trim() : "";

  const overrides = parseOverridesFromRecord({
    ...b,
    ...nested,
  });

  return { base, wordmark, logoUrl, overrides };
}

export function parseActiveBrand(
  branding: Record<string, unknown> | null | undefined
): ModuleActiveBrand {
  const raw = branding?.["data-brand"];
  if (raw === MODULE_ACTIVE_CUSTOM) return MODULE_ACTIVE_CUSTOM;
  if (typeof raw === "string" && isCpaBasePreset(raw)) return raw;
  return "bcn3";
}

export function parseModuleBrandingState(
  branding: Record<string, unknown> | null | undefined,
  moduleLogoUrl?: string | null
): ModuleBrandingState {
  const active = parseActiveBrand(branding);
  const custom = parseCustomSlotFromBranding(branding, moduleLogoUrl);
  return { active, custom };
}

export function sanitizeOverrides(overrides: BrandingOverrides): BrandingOverrides {
  const out: BrandingOverrides = {};
  for (const key of BRANDING_OVERRIDE_KEYS) {
    const value = overrides[key]?.trim();
    if (value && isValidHexColor(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function customSlotToJson(slot: CustomBrandingSlot): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    base: slot.base,
    wordmark: slot.wordmark.trim() || defaultWordmark(slot.base),
  };
  const logo = slot.logoUrl.trim();
  if (logo) payload.logo_url = logo;

  for (const [key, value] of Object.entries(sanitizeOverrides(slot.overrides))) {
    payload[key] = value;
  }
  return payload;
}

export function buildModuleBrandingPayload(state: ModuleBrandingState): Record<string, unknown> {
  const customJson = customSlotToJson(state.custom);
  const payload: Record<string, unknown> = {
    "data-brand": state.active,
    custom: customJson,
  };

  if (state.active === MODULE_ACTIVE_CUSTOM) {
    payload.wordmark = customJson.wordmark;
    for (const key of BRANDING_OVERRIDE_KEYS) {
      if (typeof customJson[key] === "string") {
        payload[key] = customJson[key];
      }
    }
  }

  return payload;
}

/** Sync custom logo into operator_modules.logo_url (stored even when a preset is active). */
export function logoUrlForRpc(state: ModuleBrandingState): string | undefined {
  const url = state.custom.logoUrl.trim();
  return url || undefined;
}

export function hasOverrides(overrides: BrandingOverrides): boolean {
  return BRANDING_OVERRIDE_KEYS.some((k) => Boolean(overrides[k]?.trim()));
}

/** Copy a preset into the custom slot (replaces wordmark, colors, and logo). */
export function copyPresetIntoCustomSlot(preset: BrandPreset): CustomBrandingSlot {
  return emptyCustomSlot(preset);
}

/** @deprecated use buildModuleBrandingPayload */
export function buildBrandingPayload(
  preset: BrandPreset,
  wordmark: string,
  overrides: BrandingOverrides
): Record<string, unknown> {
  return buildModuleBrandingPayload({
    active: preset,
    custom: {
      base: preset,
      wordmark: wordmark.trim() || defaultWordmark(preset),
      logoUrl: "",
      overrides: sanitizeOverrides(overrides),
    },
  });
}
