"use client";

import type { CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";

type Props = {
  status: CashModelRunwayStatus | null;
  computing?: boolean;
  compact?: boolean;
};

const LEVEL_CLASS: Record<CashModelRunwayStatus["level"], string> = {
  green: "chip prov-pulled",
  amber: "chip prov-assumed",
  red: "chip",
};

export function CashModelRunwayChip({ status, computing, compact }: Props) {
  if (computing) {
    return <span className="chip prov-assumed">Updating…</span>;
  }
  if (!status) return null;

  return (
    <span
      className={`${LEVEL_CLASS[status.level]}${compact ? " text-xs" : ""}`}
      style={
        status.level === "red"
          ? {
              borderColor: "var(--cinnabar,#E67E50)",
              color: "var(--cinnabar,#E67E50)",
            }
          : undefined
      }
      title="Runway status"
    >
      {status.label}
    </span>
  );
}
