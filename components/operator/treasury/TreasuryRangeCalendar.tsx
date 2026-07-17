"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TreasuryDateRange } from "@/lib/treasury/types";
import {
  addMonths,
  compareIso,
  formatRangeLabel,
  isBetweenIso,
  ledgerPresetFromDataEnd,
  monthGridCells,
  monthTitle,
  startOfMonth,
  todayIso,
} from "@/lib/treasury/period-bounds";

type Props = {
  value: TreasuryDateRange;
  onChange: (next: TreasuryDateRange) => void;
  /** Last posted date — presets anchor here, not wall-clock today. */
  dataEnd?: string | null;
};

type PickPhase = "idle" | "start-picked";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const LEDGER_PRESETS: { id: "all" | "12m" | "90d" | "ytd"; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "12m", label: "Last 12 months of data" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "This year" },
];

function parseMonthAnchor(iso: string): { year: number; month: number } {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function TreasuryRangeCalendar({ value, onChange, dataEnd }: Props) {
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PickPhase>("idle");
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const anchor = value.from ?? dataEnd ?? todayIso();
  const [leftMonth, setLeftMonth] = useState(() => startOfMonth(anchor));
  const [focusDate, setFocusDate] = useState(anchor);

  const rightMonth = addMonths(leftMonth, 1);
  const today = todayIso();
  const isAllTime = value.preset === "all" || (!value.from && !value.to);

  const closePopover = useCallback(() => {
    setOpen(false);
    setPhase("idle");
    setDraftStart(null);
    setHoverDate(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) closePopover();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, closePopover]);

  function commitRange(from: string, to: string) {
    onChange({ from, to, preset: "custom" });
    closePopover();
  }

  function handleDayClick(iso: string) {
    if (compareIso(iso, today) > 0) return;

    if (phase === "idle" || !draftStart) {
      setDraftStart(iso);
      setPhase("start-picked");
      setFocusDate(iso);
      return;
    }

    if (compareIso(iso, draftStart) >= 0) {
      commitRange(draftStart, iso);
    } else {
      setDraftStart(iso);
      setPhase("start-picked");
      setFocusDate(iso);
    }
  }

  function previewEnd(): string | null {
    if (phase === "start-picked" && draftStart && hoverDate) {
      return compareIso(hoverDate, draftStart) >= 0 ? hoverDate : draftStart;
    }
    return null;
  }

  function previewStart(): string | null {
    if (phase === "start-picked" && draftStart && hoverDate) {
      return compareIso(hoverDate, draftStart) >= 0 ? draftStart : hoverDate;
    }
    return draftStart;
  }

  function dayClass(iso: string): string {
    const classes = ["txcal-day"];
    if (compareIso(iso, today) > 0) classes.push("disabled");
    const pStart = previewStart();
    const pEnd = previewEnd() ?? (phase === "start-picked" ? draftStart : null);
    const rangeFrom = open && pStart ? pStart : value.from ?? iso;
    const rangeTo = open && pEnd ? pEnd : value.to ?? iso;

    if (!isAllTime || (open && pStart)) {
      if (iso === rangeFrom) classes.push("range-start");
      if (iso === rangeTo) classes.push("range-end");
      if (value.from && value.to && isBetweenIso(iso, rangeFrom, rangeTo)) {
        classes.push("in-range");
      } else if (open && pStart && pEnd && isBetweenIso(iso, rangeFrom, rangeTo)) {
        classes.push("in-range");
      }
    }
    if (iso === focusDate) classes.push("focused");
    return classes.join(" ");
  }

  function renderMonth(anchorIso: string) {
    const { year, month } = parseMonthAnchor(anchorIso);
    const cells = monthGridCells(year, month);

    return (
      <div className="txcal-month">
        <p className="txcal-month-title">{monthTitle(year, month)}</p>
        <div className="txcal-weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="txcal-grid" role="grid">
          {cells.map((iso, idx) =>
            iso ? (
              <button
                key={iso}
                type="button"
                role="gridcell"
                aria-selected={iso === value.from || iso === value.to}
                className={dayClass(iso)}
                disabled={compareIso(iso, today) > 0}
                onClick={() => handleDayClick(iso)}
                onMouseEnter={() => setHoverDate(iso)}
                onFocus={() => setFocusDate(iso)}
              >
                {parseMonthAnchor(iso).month === month ? Number(iso.slice(8, 10)) : ""}
              </button>
            ) : (
              <span key={`pad-${idx}`} className="txcal-day pad" aria-hidden />
            )
          )}
        </div>
      </div>
    );
  }

  const triggerLabel = isAllTime
    ? "All time"
    : value.from && value.to
      ? formatRangeLabel(value.from, value.to)
      : "Custom…";

  return (
    <div className="treasury-range-cal relative" ref={rootRef}>
      <button
        type="button"
        className="btn btn-secondary text-sm txcal-trigger"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          setOpen((v) => !v);
          setLeftMonth(startOfMonth(value.from ?? dataEnd ?? todayIso()));
        }}
      >
        {triggerLabel} ▾
      </button>

      {open ? (
        <div id={popoverId} className="txcal-popover" role="dialog" aria-label="Select date range">
          <div className="txcal-shortcuts flex flex-wrap gap-1">
            {LEDGER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`btn btn-secondary text-xs ${value.preset === p.id ? "on" : ""}`}
                onClick={() => {
                  onChange(ledgerPresetFromDataEnd(p.id, dataEnd));
                  closePopover();
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="txcal-nav">
            <button
              type="button"
              className="btn btn-secondary text-xs"
              aria-label="Previous months"
              onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
            >
              ←
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              aria-label="Next months"
              onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
            >
              →
            </button>
          </div>
          <div className="txcal-months">
            {renderMonth(leftMonth)}
            {renderMonth(rightMonth)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
