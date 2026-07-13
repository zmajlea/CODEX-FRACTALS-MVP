"use client";

import type { CSSProperties } from "react";
import { BcnCrest } from "@/components/bcn/brand/BcnBrandMarks";
import {
  themeToScopedStyleBlock,
  tokenOverridesToStyle,
} from "@/lib/branding/resolve-theme";

type Props = {
  dataBrand: string;
  wordmark: string;
  logoUrl?: string | null;
  tokenOverrides: Record<string, string>;
};

export function BrandingPreviewFrame({
  dataBrand,
  wordmark,
  logoUrl,
  tokenOverrides,
}: Props) {
  const scopeStyle = themeToScopedStyleBlock(dataBrand, tokenOverrides);
  const isFractals = dataBrand === "fractals";

  return (
    <div className="branding-preview-wrap">
      {scopeStyle ? <style>{scopeStyle}</style> : null}
      <div
        className="branding-preview-scope app cs"
        data-brand={dataBrand}
        style={tokenOverridesToStyle(tokenOverrides) as CSSProperties}
      >
        <header className="topbar appbar branding-preview-topbar">
          <a
            className={`wm${isFractals ? " fr" : ""}`}
            href="#preview"
            onClick={(e) => e.preventDefault()}
            aria-label="Branding preview"
          >
            {logoUrl?.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="crest" src={logoUrl.trim()} alt="" />
            ) : (
              <BcnCrest dataBrand={dataBrand} />
            )}
            <span className="wm-name">{wordmark}</span>
          </a>
          <div className="recpill">
            <span className="rp-primary">Sample record</span>
            <span className="rp-secondary">A1B2C3D4</span>
          </div>
        </header>
        <div className="app-main branding-preview-main">
          <div className="scard">
            <div className="c-ic" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M12 3v18M5 8h14M7 14h10" />
              </svg>
            </div>
            <div className="c-title">People &amp; contacts</div>
            <div className="c-why">Who to reach when it matters.</div>
            <div className="c-foot">
              <span className="chip sealed">
                <span className="dot" />
                Sealed
              </span>
            </div>
          </div>
          <div className="branding-preview-actions">
            <button type="button" className="btn seal" tabIndex={-1}>
              Seal section
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
