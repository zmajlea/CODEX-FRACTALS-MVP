"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TreasuryDateRange } from "@/lib/treasury/types";
import {
  addMonths,
  compareIso,
  formatRangeLabel,
  isBetweenIso,
  monthGridCells,
  monthTitle,
  startOfMonth,
  subtractDays,
  todayIso,
} from "@/lib/treasury/period-bounds";

type Props = {
  value: TreasuryDateRange;
  onChange: (next: TreasuryDateRange) => void;
};

type PickPhase = "idle" | "start-picked";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseMonthAnchor(iso: string): { year: number; month: number } {
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month: m - 1 };
}

export function TreasuryRangeCalendar({ value, onChange }: Props) {
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PickPhase>("idle");
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [leftMonth, setLeftMonth] = useState(() => startOfMonth(value.from));
  const [focusDate, setFocusDate] = useState(value.from);

  const rightMonth = addMonths(leftMonth, 1);
  const today = todayIso();

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
    const rangeFrom = open && pStart ? pStart : value.from;
    const rangeTo = open && pEnd ? pEnd : value.to;

    if (iso === rangeFrom) classes.push("range-start");
    if (iso === rangeTo) classes.push("range-end");
    if (isBetweenIso(iso, rangeFrom, rangeTo)) classes.push("in-range");
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

  function applyShortcut(days: number) {
    const to = today;
    const from = subtractDays(to, days - 1);
    commitRange(from, to);
  }

  return (
    <div className="treasury-range-cal relative" ref={rootRef}>
      <button
        type="button"
        className="btn btn-secondary text-sm txcal-trigger"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          setOpen((v) => !v);
          setLeftMonth(startOfMonth(value.from));
        }}
      >
        {formatRangeLabel(value.from, value.to)} ▾
      </button>

      {open ? (
        <div id={popoverId} className="txcal-popover" role="dialog" aria-label="Select date range">
          <div className="txcal-shortcuts">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => applyShortcut(7)}>
              7 days
            </button>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => applyShortcut(30)}>
              30 days
            </button>
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
