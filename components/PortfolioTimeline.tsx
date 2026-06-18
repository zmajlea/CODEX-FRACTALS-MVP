"use client";

import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import { composeLabel } from "@/lib/temporal/event-types";

type PortfolioTimelineProps = {
  objects: PortfolioTemporalObject[];
  activeId: string | null;
  onSelect: (id: string) => void;
  embedded?: boolean;
  showNowMarker?: boolean;
};

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "Undated";
  const d = new Date(`${dateStr}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function displayLabel(obj: PortfolioTemporalObject): string {
  if (obj.eventType && obj.qualifier) {
    return composeLabel(obj.eventType, obj.qualifier);
  }
  return obj.composedLabel || obj.title || "Untitled milestone";
}

export default function PortfolioTimeline({
  objects,
  activeId,
  onSelect,
  embedded = false,
  showNowMarker = false,
}: PortfolioTimelineProps) {
  const decrypted = objects.filter((o) => !o.isLocked);
  const lockedCount = objects.length - decrypted.length;

  const shellClass = embedded
    ? "flex flex-col flex-1 min-h-0"
    : "fixed top-16 left-0 bottom-0 w-80 z-20 border-r border-bone/40 bg-vellum/95 backdrop-blur-sm flex flex-col";

  const nowIso = new Date().toISOString().slice(0, 10);

  return (
    <aside className={shellClass}>
      {!embedded && (
        <div className="px-6 py-5 border-b border-bone/40">
          <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 mb-1">
            Portfolio Query
          </p>
          <h2 className="font-head text-xl text-obsidian tracking-wide">
            Date Timeline
          </h2>
          <p className="font-data text-[10px] text-obsidian/50 mt-2 leading-relaxed">
            {decrypted.length} decrypted milestone
            {decrypted.length === 1 ? "" : "s"} across your vaults
            {lockedCount > 0 ? ` · ${lockedCount} locked (grey)` : ""}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-6">
        {objects.length === 0 && (
          <p className="font-data text-sm text-obsidian/40 text-center py-12">
            No Date objects yet. Seal milestones from the Temporal Extraction
            Engine.
          </p>
        )}

        <ol className="relative border-l border-bone/60 ml-3">
          {showNowMarker && (
            <li className="relative pl-8 pb-6">
              <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-cinnabar border border-cinnabar" />
              <div className="font-data text-[10px] uppercase tracking-ultra text-cinnabar font-bold">
                Now · {nowIso}
              </div>
            </li>
          )}
          {objects.map((obj, index) => {
            const isActive = activeId === obj.id;
            const isLocked = obj.isLocked;
            const isSealed = obj.isSealed;

            return (
              <li key={obj.id} className="relative pl-8 pb-10 last:pb-0">
                <span
                  className={
                    "absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border " +
                    (isLocked
                      ? "bg-bone/60 border-bone"
                      : isSealed
                        ? "bg-bone border-bone"
                        : "bg-amber border-amber pulse-amber")
                  }
                  aria-hidden
                />

                <button
                  type="button"
                  onClick={() => onSelect(obj.id)}
                  className={
                    "w-full text-left transition-all duration-300 rounded-premium border px-4 py-3 " +
                    (isActive
                      ? "border-cinnabar bg-cinnabar/5 shadow-[inset_0_0_0_1px_rgba(230,126,80,0.12)]"
                      : "border-bone/30 bg-vellum hover:border-bone/60 hover:bg-bone/5")
                  }
                >
                  <time
                    dateTime={obj.parsedDate ?? undefined}
                    className="font-data text-[10px] uppercase tracking-ultra text-obsidian/45 block mb-1"
                  >
                    {formatDisplayDate(obj.parsedDate)}
                  </time>

                  {isLocked ? (
                    <>
                      <p className="font-head text-base text-obsidian/35 italic">
                        Locked vault
                      </p>
                      <p className="font-data text-[10px] text-obsidian/30 mt-1">
                        Unlock {obj.vaultName} on the Switchboard to decrypt
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-head text-base text-obsidian leading-snug truncate">
                        {displayLabel(obj)}
                      </p>
                      <p className="font-data text-[9px] uppercase tracking-widest text-obsidian/40 mt-1">
                        {obj.eventType || obj.category || "Date"}
                      </p>
                    </>
                  )}

                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="font-data text-[9px] uppercase tracking-widest text-obsidian/40 border border-bone/40 px-1.5 py-0.5">
                      {obj.vaultName}
                    </span>
                    {obj.fileLabel && (
                      <span className="font-data text-[9px] uppercase tracking-widest text-oxford/70 border border-oxford/20 bg-oxford/5 px-1.5 py-0.5 truncate max-w-[140px]">
                        {obj.fileLabel}
                      </span>
                    )}
                  </div>
                </button>

                {index < objects.length - 1 && (
                  <div
                    className="absolute left-[-1px] top-6 bottom-0 w-px bg-gradient-to-b from-bone/50 to-transparent pointer-events-none"
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
