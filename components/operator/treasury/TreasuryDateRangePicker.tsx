"use client";

import type { TreasuryDateRange } from "@/lib/treasury/types";
import {
  bucketForPreset,
  shiftRange,
  subtractDays,
  subtractMonths,
  todayIso,
} from "@/lib/treasury/period-bounds";

type Props = {
  value: TreasuryDateRange;
  onChange: (next: TreasuryDateRange) => void;
  onBucketHint?: (bucket: "day" | "week" | "month" | "year") => void;
};

const PRESETS: { id: TreasuryDateRange["preset"]; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "3m", label: "3 months" },
  { id: "12m", label: "12 months" },
  { id: "all", label: "All" },
];

function applyPreset(preset: TreasuryDateRange["preset"]): TreasuryDateRange {
  const to = todayIso();
  if (preset === "7d") return { from: subtractDays(to, 6), to, preset };
  if (preset === "30d") return { from: subtractDays(to, 29), to, preset };
  if (preset === "3m") return { from: subtractMonths(to, 3), to, preset };
  if (preset === "12m") return { from: subtractMonths(to, 12), to, preset };
  return { from: "2000-01-01", to, preset: "all" };
}

export function TreasuryDateRangePicker({ value, onChange, onBucketHint }: Props) {
  function setPreset(preset: TreasuryDateRange["preset"]) {
    const next = applyPreset(preset);
    onChange(next);
    onBucketHint?.(bucketForPreset(preset));
  }

  function shift(direction: -1 | 1) {
    const shifted = shiftRange(value.from, value.to, direction);
    onChange({ ...shifted, preset: "custom" });
  }

  const nextDisabled = value.to >= todayIso();

  return (
    <div className="treasury-daterange flex flex-wrap gap-3 items-center mb-4">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn-secondary text-xs ${value.preset === p.id ? "on" : ""}`}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-secondary text-xs" onClick={() => shift(-1)}>
          ←
        </button>
        <input
          type="date"
          className="border rounded px-2 py-1 text-sm"
          value={value.from}
          onChange={(e) =>
            onChange({ from: e.target.value, to: value.to, preset: "custom" })
          }
        />
        <span className="text-codex-muted text-sm">to</span>
        <input
          type="date"
          className="border rounded px-2 py-1 text-sm"
          value={value.to}
          max={todayIso()}
          onChange={(e) =>
            onChange({ from: value.from, to: e.target.value, preset: "custom" })
          }
        />
        <button
          type="button"
          className="btn btn-secondary text-xs"
          disabled={nextDisabled}
          onClick={() => shift(1)}
        >
          →
        </button>
      </div>
    </div>
  );
}

export { applyPreset as treasuryDatePreset };
