"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BcnCrest } from "@/components/bcn/brand/BcnBrandMarks";

type Props = {
  wordmark: string;
  dataBrand?: string;
  logoUrl?: string | null;
  homeHref?: string;
  recordPill: {
    primary: string;
    secondary?: string;
  };
  keyLabel?: string;
  keyUnlocked?: boolean;
  who?: string | null;
  showTextScale?: boolean;
  /** B25 — hamburger under 1024; omitted = no nav control (legacy topbars). */
  navOpen?: boolean;
  onNavToggle?: () => void;
};

const TEXT_SCALE_KEY = "fractals-textscale";

function applyZoomToViewHost(value: number) {
  const host = document.getElementById("viewhost");
  if (host) {
    if (value === 1) host.style.removeProperty("zoom");
    else host.style.zoom = String(value);
  }
  document.documentElement.style.removeProperty("zoom");
}

export function BcnTopbarContinuity({
  wordmark,
  dataBrand,
  logoUrl,
  homeHref = "#",
  recordPill,
  keyLabel = "Key unlocked",
  keyUnlocked = true,
  who,
  showTextScale = true,
  navOpen = false,
  onNavToggle,
}: Props) {
  const [textScale, setTextScale] = useState(1);
  const isFractals = dataBrand === "fractals";

  useEffect(() => {
    try {
      const stored = localStorage.getItem(TEXT_SCALE_KEY);
      if (stored) {
        const value = parseFloat(stored);
        if (!Number.isNaN(value)) {
          setTextScale(value);
          applyZoomToViewHost(value);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  function applyTextScale(value: number) {
    setTextScale(value);
    applyZoomToViewHost(value);
    try {
      localStorage.setItem(TEXT_SCALE_KEY, String(value));
    } catch {
      /* ignore */
    }
  }

  const logo = logoUrl?.trim() ?? "";
  const wm = (
    <>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="crest" src={logo} alt="" />
      ) : (
        <BcnCrest dataBrand={dataBrand} />
      )}
      <span className="wm-name">{wordmark}</span>
    </>
  );

  return (
    <header className="topbar appbar" id="topbar">
      {onNavToggle ? (
        <button
          type="button"
          className="navbtn"
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navOpen}
          aria-controls="rail"
          onClick={onNavToggle}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {navOpen ? (
              <path d="M4 4l12 12M16 4L4 16" />
            ) : (
              <path d="M3 5h14M3 10h14M3 15h14" />
            )}
          </svg>
        </button>
      ) : null}

      {homeHref.startsWith("#") ? (
        <a className={`wm${isFractals ? " fr" : ""}`} href={homeHref} aria-label={`${wordmark} — home`}>
          {wm}
        </a>
      ) : (
        <Link className={`wm${isFractals ? " fr" : ""}`} href={homeHref} aria-label={`${wordmark} — home`}>
          {wm}
        </Link>
      )}

      <span className="recpill">
        <span className="pdot" />
        {recordPill.primary}
        {recordPill.secondary ? (
          <span className="rid"> · {recordPill.secondary}</span>
        ) : null}
      </span>

      <span className="keypill">
        <span className="kd" style={keyUnlocked ? undefined : { background: "var(--mute)", boxShadow: "none" }} />
        <span className="kp-t">{keyUnlocked ? keyLabel : "Key locked"}</span>
      </span>

      <span className="spacer" />

      {showTextScale ? (
        <span className="ts-control" title="Text size — make everything larger or smaller">
          <span className="a-min" aria-hidden="true">
            A
          </span>
          <input
            className="ts-slider"
            type="range"
            min={0.9}
            max={1.5}
            step={0.05}
            value={textScale}
            aria-label="Text size"
            onChange={(e) => applyTextScale(parseFloat(e.target.value))}
          />
          <span className="a-max" aria-hidden="true">
            A
          </span>
        </span>
      ) : null}

      {who ? <span className="who">{who}</span> : null}
    </header>
  );
}
