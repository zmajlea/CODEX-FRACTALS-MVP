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
};

const TEXT_SCALE_KEY = "fractals-textscale";

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
          document.documentElement.style.zoom = String(value);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  function applyTextScale(value: number) {
    setTextScale(value);
    document.documentElement.style.zoom = String(value);
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
        {keyUnlocked ? keyLabel : "Key locked"}
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
