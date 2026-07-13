"use client";

import { BcnSealMark } from "@/components/bcn/brand/BcnBrandMarks";

type Props = {
  phase: "off" | "on" | "play";
  dataBrand?: string;
  caption?: string;
  onWaxAnimationEnd?: (animationName: string) => void;
  onCapAnimationEnd?: (animationName: string) => void;
};

export function SealFx({
  phase,
  dataBrand,
  caption = "Preparation is an act of love.",
  onWaxAnimationEnd,
  onCapAnimationEnd,
}: Props) {
  const className = ["sealfx", phase === "on" || phase === "play" ? "on" : "", phase === "play" ? "play" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} id="sealfx" aria-live="polite">
      <div
        className="wax"
        id="waxmark"
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          onWaxAnimationEnd?.(e.animationName);
        }}
      >
        <BcnSealMark dataBrand={dataBrand} />
      </div>
      <div
        className="cap"
        id="sealcap"
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          onCapAnimationEnd?.(e.animationName);
        }}
      >
        {caption}
      </div>
    </div>
  );
}
