"use client";

import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

type RecordLedgerProps = {
  objects: PortfolioTemporalObject[];
  focusedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

export default function RecordLedger({
  objects,
  focusedId,
  onSelect,
  onOpen,
}: RecordLedgerProps) {
  if (objects.length === 0) {
    return (
      <p className="font-data text-xs text-obsidian/40 uppercase tracking-widest py-8 text-center">
        No pulses yet — run a query or ingest documents.
      </p>
    );
  }

  return (
    <div className="border border-bone bg-vellum/80">
      <div className="grid grid-cols-[100px_90px_1fr] gap-2 px-4 py-2 border-b border-bone font-data text-[9px] uppercase tracking-ultra text-obsidian/40">
        <span>Date</span>
        <span>Category</span>
        <span>Title</span>
      </div>
      {objects.map((obj) => {
        const isFocused = focusedId === obj.id;
        const pulseColor = obj.isLocked
          ? "bg-obsidian/20"
          : obj.isSealed
            ? "bg-bone"
            : "bg-amber/60";
        return (
          <button
            key={obj.id}
            type="button"
            onClick={() => onSelect(obj.id)}
            onDoubleClick={() => onOpen(obj.id)}
            className={
              "w-full grid grid-cols-[100px_90px_1fr] gap-2 px-4 py-3 text-left border-b border-bone/50 font-data text-xs transition-colors " +
              (isFocused ? "bg-bone/30" : "hover:bg-bone/10")
            }
          >
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${pulseColor}`} />
              {obj.parsedDate ?? "—"}
            </span>
            <span className="uppercase tracking-wider text-obsidian/60 truncate">
              {obj.category ?? "—"}
            </span>
            <span className="truncate text-obsidian">
              {obj.isLocked ? "Locked" : obj.title ?? "Untitled"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
