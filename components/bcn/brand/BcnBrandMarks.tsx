import type { BrandPreset } from "@/lib/branding/resolve-theme";

type BrandMarkProps = {
  dataBrand?: string;
  className?: string;
};

function isFractals(dataBrand?: string): boolean {
  return dataBrand === "fractals";
}

function isSummit(dataBrand?: string): boolean {
  return dataBrand === "summit";
}

/** product-build-v2 crest() */
export function BcnCrest({ dataBrand, className = "crest" }: BrandMarkProps) {
  if (isSummit(dataBrand)) {
    return (
      <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
        <path
          d="M32 3 57 12.5v21C57 49.5 46.6 61.4 32 67 17.4 61.4 7 49.5 7 33.5v-21L32 3Z"
          fill="var(--brand)"
        />
        <path d="M14 45 26 27l6.5 8.5L38 28l12 17Z" fill="var(--foil)" />
        <path d="M26 27l3-4 3 4-3 4Z" fill="#fff" opacity=".85" />
      </svg>
    );
  }

  if (isFractals(dataBrand)) {
    return (
      <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
        <path
          d="M32 8 56 36 32 64 8 36Z"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="3"
        />
        <path d="M32 22 44 36 32 50 20 36Z" fill="var(--brand)" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
      <g fill="var(--foil)">
        <path d="M9 9q7.5 0 10.5 6.4-7.4 3-11.5-2.2Z" />
        <path d="M55 9q-7.5 0-10.5 6.4 7.4 3 11.5-2.2Z" />
      </g>
      <path
        d="M14 12 44.5 55M50 12 19.5 55"
        stroke="var(--foil)"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M32 8 52.5 14.4v15.7C52.5 43 43.3 52.7 32 57.2 20.7 52.7 11.5 43 11.5 30.1V14.4L32 8Z"
        fill="var(--brand)"
        stroke="var(--foil)"
        strokeWidth="1.1"
      />
      <path
        d="M32 23c3.7 3.5 5.7 6.5 5.7 10a5.7 5.7 0 0 1-11.4 0c0-2 .8-3.8 2.1-5.1.4 1.5 1.3 2.5 2.7 3-.2-3 .5-5.1.9-7.9Z"
        fill="#fff"
      />
    </svg>
  );
}

/** product-build-v2 sealMark(cls) */
export function BcnSealMark({
  dataBrand,
  className = "",
}: BrandMarkProps & { className?: string }) {
  if (isSummit(dataBrand)) {
    return (
      <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
        <path
          d="M32 2.5 58.5 11v22.5C58.5 51 47.6 63.4 32 69.5 16.4 63.4 5.5 51 5.5 33.5V11L32 2.5Z"
          fill="var(--seal)"
        />
        <path
          d="M32 7.6 53.7 14.6V33.5C53.7 48.4 44.6 59.2 32 64.5 19.4 59.2 10.3 48.4 10.3 33.5V14.6L32 7.6Z"
          fill="none"
          stroke="var(--foil)"
          strokeWidth="1.3"
        />
        <path d="M16 42 27 27l5 6.5 4.5-5.5L48 42Z" fill="var(--foil)" />
        <text
          x="32"
          y="55"
          textAnchor="middle"
          fontFamily="monospace"
          fontWeight="600"
          fontSize="6.5"
          letterSpacing="1.5"
          fill="var(--foil)"
        >
          SUMMIT
        </text>
      </svg>
    );
  }

  if (isFractals(dataBrand)) {
    return (
      <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
        <rect x="9" y="11" width="46" height="46" rx="5" fill="var(--seal)" />
        <rect
          x="13.5"
          y="15.5"
          width="37"
          height="37"
          rx="3"
          fill="none"
          stroke="var(--paper)"
          strokeWidth="1"
          opacity=".55"
        />
        <path
          d="M32 21 44 34 32 47 20 34Z"
          fill="none"
          stroke="var(--paper)"
          strokeWidth="2.4"
        />
        <path d="M32 28.5 37.5 34 32 39.5 26.5 34Z" fill="var(--paper)" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 64 72" aria-hidden="true">
      <path
        d="M32 2.5 58.5 11v22.5C58.5 51 47.6 63.4 32 69.5 16.4 63.4 5.5 51 5.5 33.5V11L32 2.5Z"
        fill="var(--seal)"
      />
      <path
        d="M32 7.6 53.7 14.6V33.5C53.7 48.4 44.6 59.2 32 64.5 19.4 59.2 10.3 48.4 10.3 33.5V14.6L32 7.6Z"
        fill="none"
        stroke="var(--foil)"
        strokeWidth="1.3"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="18"
        fill="#fff"
        dominantBaseline="middle"
      >
        FF
      </text>
      <text
        x="32"
        y="49"
        textAnchor="middle"
        fontFamily="monospace"
        fontWeight="600"
        fontSize="6.5"
        letterSpacing="1.5"
        fill="var(--foil)"
      >
        SEALED
      </text>
    </svg>
  );
}

/** product-build-v2 nib() */
export function BcnNib({ dataBrand }: BrandMarkProps) {
  if (isSummit(dataBrand)) {
    return (
      <svg className="sealnib" viewBox="0 0 64 72" aria-hidden="true">
        <path
          d="M32 2.5 58.5 11v22.5C58.5 51 47.6 63.4 32 69.5 16.4 63.4 5.5 51 5.5 33.5V11L32 2.5Z"
          fill="currentColor"
        />
        <path d="M16 44 28 28l6 7.5 4.5-5.5L48 44Z" fill="var(--foil)" />
      </svg>
    );
  }

  if (isFractals(dataBrand)) {
    return (
      <svg className="sealnib" viewBox="0 0 64 72" aria-hidden="true">
        <circle cx="32" cy="36" r="26" fill="currentColor" />
        <path d="M32 22 44 36 32 50 20 36Z" fill="var(--paper)" />
      </svg>
    );
  }

  return (
    <svg className="sealnib" viewBox="0 0 64 72" aria-hidden="true">
      <path
        d="M32 2.5 58.5 11v22.5C58.5 51 47.6 63.4 32 69.5 16.4 63.4 5.5 51 5.5 33.5V11L32 2.5Z"
        fill="currentColor"
      />
      <text
        x="32"
        y="46"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="26"
        fill="#fff"
      >
        FF
      </text>
    </svg>
  );
}

export function defaultWordmark(dataBrand?: string): string {
  if (dataBrand === "fractals") return "FRACTALS";
  if (dataBrand === "summit") return "Summit Treasury";
  return "Business Continuity Navigator";
}

/** product-build-v2 crest() — brand-aware SVG factory */
export function crest(dataBrand?: string, className = "crest") {
  return <BcnCrest dataBrand={dataBrand} className={className} />;
}

/** product-build-v2 sealMark(cls) — brand-aware SVG factory */
export function sealMark(dataBrand?: string, className = "") {
  return <BcnSealMark dataBrand={dataBrand} className={className} />;
}

/** product-build-v2 nib() — brand-aware SVG factory */
export function nib(dataBrand?: string) {
  return <BcnNib dataBrand={dataBrand} />;
}

export type { BrandPreset };
