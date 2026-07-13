import type { ReactNode } from "react";

type Props = {
  recordLabel: string;
  sectionLabel: string;
  onHome?: () => void;
};

export function SectionCrumb({ recordLabel, sectionLabel, onHome }: Props) {
  return (
    <div className="crumb">
      <a
        href="#hub"
        onClick={(e) => {
          if (onHome) {
            e.preventDefault();
            onHome();
          }
        }}
      >
        {recordLabel}
      </a>
      <span aria-hidden="true"> › </span>
      {sectionLabel}
    </div>
  );
}

export type { ReactNode };
