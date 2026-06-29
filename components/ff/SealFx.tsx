"use client";

type Props = {
  visible: boolean;
};

export function SealFx({ visible }: Props) {
  if (!visible) return null;

  return (
    <div className="ff-seal-overlay" aria-live="polite">
      <div className="ff-seal-stamp">
        <svg className="ff-seal-svg" viewBox="0 0 64 72" aria-hidden>
          <path
            d="M32 2.5 58.5 11v22.5C58.5 51 47.6 63.4 32 69.5 16.4 63.4 5.5 51 5.5 33.5V11L32 2.5Z"
            fill="var(--cinnabar)"
          />
          <path
            d="M32 7.6 53.7 14.6V33.5C53.7 48.4 44.6 59.2 32 64.5 19.4 59.2 10.3 48.4 10.3 33.5V14.6L32 7.6Z"
            fill="none"
            stroke="#f5e6c8"
            strokeWidth="1.3"
          />
          <text
            x="32"
            y="40"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontWeight="700"
            fontSize="16"
            fill="#fff"
          >
            FF
          </text>
          <text
            x="32"
            y="54"
            textAnchor="middle"
            fontFamily="monospace"
            fontWeight="600"
            fontSize="6.5"
            letterSpacing="1"
            fill="#f5e6c8"
          >
            APPROVED
          </text>
        </svg>
        <p className="mt-4 text-center text-sm text-white font-head italic">
          Preparation is an act of love.
        </p>
      </div>
    </div>
  );
}
