"use client";

import { useMemo, useState } from "react";
import type { EmailBranding } from "@/lib/email/types";

type Props = {
  brands: Record<string, { name: string; logo_url: string | null; brand_color_hex: string }>;
  presets: string[];
  brandingForPreset: (preset: string) => EmailBranding;
  renderInvite: (branding: EmailBranding) => string;
  renderAdvisor: (branding: EmailBranding) => string;
};

export function EmailPreviewClient({
  presets,
  brandingForPreset,
  renderInvite,
  renderAdvisor,
}: Props) {
  const [brand, setBrand] = useState("bcn3");
  const [template, setTemplate] = useState<"invite-client" | "trusted-advisor">(
    "invite-client"
  );

  const html = useMemo(() => {
    const branding = brandingForPreset(brand);
    return template === "trusted-advisor"
      ? renderAdvisor(branding)
      : renderInvite(branding);
  }, [brand, template, brandingForPreset, renderInvite, renderAdvisor]);

  return (
    <div className="app cs min-h-screen" data-brand="fractals" id="app">
      <header className="topbar appbar">
        <span className="wm-name">Email preview (dev)</span>
        <span className="grow" />
      </header>
      <div className="app-wrap" style={{ padding: 24 }}>
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-h">
            <span className="ph-t">White-label QA</span>
          </div>
          <div className="fgrid">
            <div className="field wide">
              <label htmlFor="ep-brand">Brand preset</label>
              <select
                id="ep-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              >
                {presets.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="field wide">
              <label htmlFor="ep-template">Template</label>
              <select
                id="ep-template"
                value={template}
                onChange={(e) =>
                  setTemplate(e.target.value as "invite-client" | "trusted-advisor")
                }
              >
                <option value="invite-client">Invite client</option>
                <option value="trusted-advisor">Trusted advisor</option>
              </select>
            </div>
          </div>
        </div>
        <iframe
          title="Email preview"
          srcDoc={html}
          style={{
            width: "100%",
            minHeight: 720,
            border: "1px solid var(--paper-edge)",
            borderRadius: 8,
            background: "#e8e4dc",
          }}
        />
      </div>
    </div>
  );
}
