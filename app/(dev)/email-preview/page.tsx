import { BRAND_PRESETS } from "@/lib/branding/resolve-theme";
import { emailBrandingFromTenant } from "@/lib/email/branding";
import {
  inviteClientEmailHtml,
  trustedAdvisorInviteEmailHtml,
} from "@/lib/email/templates-html";
import { EmailPreviewClient } from "./EmailPreviewClient";
import "@/app/styles/continuity.css";

const PREVIEW_BRANDS: Record<
  string,
  { name: string; logo_url: string | null; brand_color_hex: string }
> = {
  bcn1: { name: "Randall & Associates", logo_url: null, brand_color_hex: "#8C1D18" },
  bcn2: { name: "Engine House Advisory", logo_url: null, brand_color_hex: "#A8261F" },
  bcn3: { name: "Heritage Ledger CPA", logo_url: null, brand_color_hex: "#8A1E1A" },
  bcn4: { name: "Firehouse Financial", logo_url: null, brand_color_hex: "#C8161C" },
  fractals: { name: "CodexOne Fractals", logo_url: null, brand_color_hex: "#E67E50" },
  summit: { name: "Summit Treasury", logo_url: null, brand_color_hex: "#13385E" },
};

export default function EmailPreviewPage() {
  return (
    <EmailPreviewClient
      brands={PREVIEW_BRANDS}
      presets={[...BRAND_PRESETS]}
      renderInvite={(branding) =>
        inviteClientEmailHtml({
          branding,
          clientName: "Bill Harmon",
          firmName: branding.firmName ?? "Your firm",
          moduleName: "Business Continuity Navigator",
          inviteUrl: "https://example.com/client/login?invite=preview",
        })
      }
      renderAdvisor={(branding) =>
        trustedAdvisorInviteEmailHtml({
          branding,
          advisorName: "Dana Whitfield",
          role: "Operator / Accountant",
          clientName: "Bill Harmon",
        })
      }
      brandingForPreset={(preset) =>
        emailBrandingFromTenant({
          name: PREVIEW_BRANDS[preset]?.name ?? preset,
          logo_url: PREVIEW_BRANDS[preset]?.logo_url ?? null,
          brand_color_hex: PREVIEW_BRANDS[preset]?.brand_color_hex,
          wordmark: PREVIEW_BRANDS[preset]?.name ?? preset,
        })
      }
    />
  );
}
