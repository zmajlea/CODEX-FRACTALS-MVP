"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

type RecordLedgerProps = {
  objects: PortfolioTemporalObject[];
  focusedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

const ROW_HEIGHT = 44;
const OVERSCAN = 8;

export default function RecordLedger({
  objects,
  focusedId,
  onSelect,
  onOpen,
}: RecordLedgerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  const updateViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, [updateViewport, objects.length]);

  useEffect(() => {
    if (!focusedId || !scrollRef.current) return;
    const index = objects.findIndex((o) => o.id === focusedId);
    if (index < 0) return;
    const rowTop = index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const { scrollTop: st, clientHeight } = scrollRef.current;
    if (rowTop < st) {
      scrollRef.current.scrollTop = rowTop;
    } else if (rowBottom > st + clientHeight) {
      scrollRef.current.scrollTop = rowBottom - clientHeight;
    }
  }, [focusedId, objects]);

  if (objects.length === 0) {
    return (
      <p className="font-data text-xs text-obsidian/40 uppercase tracking-widest py-8 text-center">
        No pulses yet — run a query or ingest documents.
      </p>
    );
  }

  const totalHeight = objects.length * ROW_HEIGHT;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN
  );
  const visibleCount =
    Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(objects.length, startIndex + visibleCount);
  const visible = objects.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  return (
    <div className="border border-bone bg-vellum/80">
      <div className="grid grid-cols-[100px_90px_1fr] gap-2 px-4 py-2 border-b border-bone font-data text-[9px] uppercase tracking-ultra text-obsidian/40">
        <span>Date</span>
        <span>Category</span>
        <span>Title</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={updateViewport}
        className="max-h-[min(60vh,520px)] overflow-y-auto"
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visible.map((obj) => {
              const isFocused = focusedId === obj.id;
              const pulseColor = obj.isLocked
                ? "bg-obsidian/20"
                : obj.isSealed
                  ? "bg-bone"
                  : "bg-amber";
              return (
                <button
                  key={obj.id}
                  type="button"
                  onClick={() => onSelect(obj.id)}
                  onDoubleClick={() => onOpen(obj.id)}
                  style={{ height: ROW_HEIGHT }}
                  className={
                    "w-full grid grid-cols-[100px_90px_1fr] gap-2 px-4 py-3 text-left border-b border-bone/50 font-data text-xs transition-colors " +
                    (isFocused ? "bg-bone/30" : "hover:bg-bone/10")
                  }
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${pulseColor}`}
                    />
                    {obj.parsedDate ?? "—"}
                  </span>
                  <span className="uppercase tracking-wider text-obsidian/60 truncate">
                    {obj.category ?? "—"}
                  </span>
                  <span className="truncate text-obsidian">
                    {obj.isLocked
                      ? "Locked"
                      : obj.composedLabel || obj.title || "Untitled"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
