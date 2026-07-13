"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { BrandingPreviewFrame } from "@/components/platform/BrandingPreviewFrame";
import {
  BRANDING_OVERRIDE_KEYS,
  BRANDING_OVERRIDE_LABELS,
  buildModuleBrandingPayload,
  copyPresetIntoCustomSlot,
  OPERATOR_BASE_PRESETS,
  hasOverrides,
  isValidHexColor,
  logoUrlForRpc,
  MODULE_ACTIVE_CUSTOM,
  parseModuleBrandingState,
  PRESET_LABELS,
  sanitizeOverrides,
  type CustomBrandingSlot,
  type ModuleActiveBrand,
  type ModuleBrandingState,
} from "@/lib/branding/custom-tokens";
import { resolvePreviewTheme, type BrandPreset } from "@/lib/branding/resolve-theme";
import { defaultWordmark } from "@/components/bcn/brand/BcnBrandMarks";
import { Field } from "@/components/bcn/atoms/Field";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import type { Database } from "@/lib/database.types";

export type DistributorModuleRow = {
  slug: string;
  name: string;
  status: string;
  logo_url?: string | null;
  branding?: Record<string, unknown> | null;
};

type Props = {
  tenantId: string;
  modules: DistributorModuleRow[];
  onSaved?: () => void;
};

const CUSTOM_WIZARD_STEPS = [
  { id: "identity", label: "2. Identity" },
  { id: "colors", label: "3. Colors" },
  { id: "review", label: "4. Preview & save" },
] as const;

type CustomWizardStep = (typeof CUSTOM_WIZARD_STEPS)[number]["id"];

const COPY_CONFIRM_MESSAGE =
  "This will overwrite your custom branding (wordmark, colors, and logo). Continue?";

export function ModuleBrandingPanel({ tenantId, modules, onSaved }: Props) {
  const supabase = createClient();
  const [moduleSlug, setModuleSlug] = useState(modules[0]?.slug ?? "bcn");
  const [active, setActive] = useState<ModuleActiveBrand>("bcn3");
  const [custom, setCustom] = useState<CustomBrandingSlot>(() =>
    copyPresetIntoCustomSlot("bcn3")
  );
  const [customStep, setCustomStep] = useState<CustomWizardStep>("identity");
  const [copyConfirmPreset, setCopyConfirmPreset] = useState<BrandPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = modules.find((m) => m.slug === moduleSlug) ?? modules[0];
  const isCustom = active === MODULE_ACTIVE_CUSTOM;
  const customStepIndex = CUSTOM_WIZARD_STEPS.findIndex((s) => s.id === customStep);

  const brandingState = useMemo<ModuleBrandingState>(
    () => ({ active, custom }),
    [active, custom]
  );

  const loadModuleFields = useCallback((mod: DistributorModuleRow | undefined) => {
    if (!mod) return;
    const state = parseModuleBrandingState(mod.branding ?? undefined, mod.logo_url);
    setActive(state.active);
    setCustom(state.custom);
    setCustomStep("identity");
    setCopyConfirmPreset(null);
    setMessage(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (modules.length === 0) return;
    if (!modules.some((m) => m.slug === moduleSlug)) {
      setModuleSlug(modules[0]!.slug);
      return;
    }
    loadModuleFields(selected);
  }, [modules, moduleSlug, selected, loadModuleFields]);

  const previewTheme = useMemo(() => {
    if (isCustom) {
      return resolvePreviewTheme(
        custom.base,
        custom.wordmark.trim() || defaultWordmark(custom.base),
        sanitizeOverrides(custom.overrides),
        custom.logoUrl.trim() || null,
        { isCustom: true }
      );
    }
    return resolvePreviewTheme(
      active as BrandPreset,
      defaultWordmark(active as BrandPreset),
      {},
      null,
      { isCustom: false }
    );
  }, [active, custom, isCustom]);

  function updateCustom(patch: Partial<CustomBrandingSlot>) {
    setCustom((prev) => ({ ...prev, ...patch }));
  }

  function setCustomOverride(key: (typeof BRANDING_OVERRIDE_KEYS)[number], value: string) {
    setCustom((prev) => {
      const overrides = { ...prev.overrides };
      const trimmed = value.trim();
      if (!trimmed) delete overrides[key];
      else overrides[key] = trimmed;
      return { ...prev, overrides };
    });
  }

  function clearCustomOverride(key: (typeof BRANDING_OVERRIDE_KEYS)[number]) {
    setCustom((prev) => {
      const overrides = { ...prev.overrides };
      delete overrides[key];
      return { ...prev, overrides };
    });
  }

  function selectActive(next: ModuleActiveBrand) {
    setActive(next);
    setMessage(null);
    setError(null);
    if (next === MODULE_ACTIVE_CUSTOM) {
      setCustomStep("identity");
    }
  }

  function requestCopyFromPreset(preset: BrandPreset) {
    setCopyConfirmPreset(preset);
  }

  function confirmCopyFromPreset() {
    if (!copyConfirmPreset) return;
    setCustom(copyPresetIntoCustomSlot(copyConfirmPreset));
    setCopyConfirmPreset(null);
    setCustomStep("identity");
  }

  async function persistBranding(state: ModuleBrandingState, successNote: string) {
    if (!selected) return false;

    setBusy(true);
    setError(null);
    setMessage(null);

    const branding = buildModuleBrandingPayload(state);

    const { error: rpcErr } = await supabase.rpc("set_operator_module_branding", {
      p_tenant_id: tenantId,
      p_module_slug: selected.slug,
      p_branding: branding as Database["public"]["Functions"]["set_operator_module_branding"]["Args"]["p_branding"],
      p_logo_url: logoUrlForRpc(state),
    });

    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return false;
    }

    setMessage(successNote);
    onSaved?.();
    return true;
  }

  async function applyPresetSkin(preset: BrandPreset) {
    const state: ModuleBrandingState = { active: preset, custom };
    setActive(preset);
    await persistBranding(
      state,
      `Clients now see ${PRESET_LABELS[preset]}. Your custom branding is saved for when you switch back to Custom.`
    );
  }

  async function handleSaveCustom(e: React.FormEvent) {
    e.preventDefault();
    await persistBranding(
      brandingState,
      `Custom branding saved for ${selected?.name ?? "module"}.`
    );
  }

  function goNextCustom() {
    if (customStepIndex < CUSTOM_WIZARD_STEPS.length - 1) {
      setCustomStep(CUSTOM_WIZARD_STEPS[customStepIndex + 1]!.id);
    }
  }

  function goBackCustom() {
    if (customStepIndex > 0) {
      setCustomStep(CUSTOM_WIZARD_STEPS[customStepIndex - 1]!.id);
    }
  }

  if (modules.length === 0) {
    return (
      <Panel>
        <p className="panel-note">Enable a module to customize white-label branding.</p>
      </Panel>
    );
  }

  return (
    <Panel id="module-branding">
      <div className="panel-h">
        <span className="ph-t">Module branding</span>
      </div>
      <p className="panel-note">
        Choose bcn1, bcn2, or bcn3 for the original continuity skins, or Custom for your
        white-label (wordmark, logo, and colors). Custom is kept even when you switch back
        to a preset.
      </p>

      <form onSubmit={(e) => void handleSaveCustom(e)}>
        <div className="field wide">
          <label htmlFor="branding-module">Module</label>
          <select
            id="branding-module"
            value={moduleSlug}
            onChange={(e) => setModuleSlug(e.target.value)}
          >
            {modules.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
                {m.status === "beta" ? " (beta)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="field wide">
          <label>Active skin for clients</label>
          <div className="choices sm" role="group" aria-label="Active skin">
            {OPERATOR_BASE_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                className={`seg${active === id ? " on" : ""}`}
                onClick={() => selectActive(id)}
              >
                {id.toUpperCase()} · {PRESET_LABELS[id]}
              </button>
            ))}
            <button
              type="button"
              className={`seg${isCustom ? " on" : ""}`}
              onClick={() => selectActive(MODULE_ACTIVE_CUSTOM)}
            >
              Custom
            </button>
          </div>

          {!isCustom ? (
            <div className="sealbar" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn seal"
                disabled={busy}
                onClick={() => void applyPresetSkin(active as BrandPreset)}
              >
                {busy ? "Applying…" : `Apply ${(active as string).toUpperCase()} for clients`}
              </button>
            </div>
          ) : null}
        </div>

        {isCustom ? (
          <>
            <div className="field wide">
              <label>Custom base skin</label>
              <p className="panel-note" style={{ marginTop: 0 }}>
                Start from an FF preset, then tune identity and colors below.
              </p>
              <div className="choices sm" role="group" aria-label="Copy custom from preset">
                {OPERATOR_BASE_PRESETS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`seg${custom.base === id ? " on" : ""}`}
                    onClick={() => requestCopyFromPreset(id)}
                  >
                    Copy from {id.toUpperCase()}
                  </button>
                ))}
              </div>
              {copyConfirmPreset ? (
                <div className="panel" style={{ marginTop: 10 }}>
                  <p className="panel-note" style={{ marginTop: 0 }}>
                    {COPY_CONFIRM_MESSAGE}
                  </p>
                  <div className="sealbar" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setCopyConfirmPreset(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn seal"
                      onClick={confirmCopyFromPreset}
                    >
                      Overwrite custom
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="branding-wizard-steps" role="tablist" aria-label="Custom branding steps">
              {CUSTOM_WIZARD_STEPS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`seg${customStep === s.id ? " on" : ""}`}
                  role="tab"
                  aria-selected={customStep === s.id}
                  onClick={() => setCustomStep(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {customStep === "identity" ? (
              <FGrid>
                <Field
                  label="Wordmark"
                  value={custom.wordmark}
                  onChange={(e) => updateCustom({ wordmark: e.target.value })}
                  placeholder={defaultWordmark(custom.base)}
                  maxLength={120}
                />
                <Field
                  label="Logo URL (custom only)"
                  value={custom.logoUrl}
                  onChange={(e) => updateCustom({ logoUrl: e.target.value })}
                  placeholder="https://…"
                />
              </FGrid>
            ) : null}

            {customStep === "colors" ? (
              <div className="field wide">
                <label>Color overrides</label>
                <p className="panel-note" style={{ marginTop: 0 }}>
                  Optional hex values on top of {custom.base.toUpperCase()}. Leave blank for
                  preset defaults.
                </p>
                {BRANDING_OVERRIDE_KEYS.map((key) => {
                  const value = custom.overrides[key] ?? "";
                  const invalid = Boolean(value && !isValidHexColor(value));
                  return (
                    <div key={key} className="color-override-row">
                      <span>{BRANDING_OVERRIDE_LABELS[key]}</span>
                      <input
                        type="color"
                        value={
                          value && isValidHexColor(value)
                            ? value.length === 4
                              ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
                              : value.slice(0, 7)
                            : "#888888"
                        }
                        aria-label={`${BRANDING_OVERRIDE_LABELS[key]} picker`}
                        onChange={(e) => setCustomOverride(key, e.target.value)}
                      />
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="text"
                          value={value}
                          placeholder="—"
                          aria-invalid={invalid}
                          onChange={(e) => setCustomOverride(key, e.target.value)}
                        />
                        {value ? (
                          <button
                            type="button"
                            className="btn sm ghost"
                            onClick={() => clearCustomOverride(key)}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {customStep === "review" ? (
              <p className="panel-note">
                Base: <strong>{PRESET_LABELS[custom.base]}</strong>
                {hasOverrides(sanitizeOverrides(custom.overrides))
                  ? " · custom colors"
                  : " · preset colors"}
                {custom.logoUrl.trim() ? " · logo" : ""}
              </p>
            ) : null}
          </>
        ) : (
          <p className="panel-note">
            Preview shows the active preset clients see. Switch to Custom to edit your saved
            white-label.
          </p>
        )}

        <BrandingPreviewFrame
          dataBrand={previewTheme.dataBrand}
          wordmark={previewTheme.wordmark ?? defaultWordmark(custom.base)}
          logoUrl={previewTheme.logoUrl}
          tokenOverrides={previewTheme.tokenOverrides}
        />

        {error ? (
          <p className="panel-note" style={{ color: "var(--cinnabar)" }}>
            {error}
          </p>
        ) : null}
        {message ? <p className="panel-note">{message}</p> : null}

        {isCustom ? (
          <div className="sealbar">
            {customStepIndex > 0 ? (
              <button type="button" className="btn ghost" onClick={goBackCustom}>
                Back
              </button>
            ) : null}
            {customStep !== "review" ? (
              <button type="button" className="btn" onClick={goNextCustom}>
                Continue
              </button>
            ) : (
              <button type="submit" className="btn seal" disabled={busy}>
                {busy ? "Saving…" : "Save custom branding"}
              </button>
            )}
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
