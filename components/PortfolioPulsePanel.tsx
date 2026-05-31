"use client";

import Link from "next/link";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

type PortfolioPulsePanelProps = {
  object: PortfolioTemporalObject | null;
  onClose: () => void;
  onViewSource: (obj: PortfolioTemporalObject) => void;
};

export default function PortfolioPulsePanel({
  object,
  onClose,
  onViewSource,
}: PortfolioPulsePanelProps) {
  if (!object) return null;

  return (
    <aside className="fixed top-16 right-0 bottom-0 w-96 z-30 border-l border-bone/50 bg-vellum/95 backdrop-blur-xl shadow-[-12px_0_40px_rgba(0,0,0,0.06)] flex flex-col">
      <div className="px-6 py-5 border-b border-bone/40 flex items-start justify-between gap-4">
        <div>
          <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 mb-1">
            Milestone · {object.vaultName}
          </p>
          <h2 className="font-head text-xl text-obsidian tracking-wide leading-snug">
            {object.isLocked ? "Locked milestone" : object.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-obsidian/40 hover:text-obsidian shrink-0"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 space-y-5">
        {object.isLocked ? (
          <p className="font-data text-sm text-obsidian/45 leading-relaxed">
            Unlock this vault on the Switchboard to decrypt this milestone.
          </p>
        ) : (
          <>
            {object.parsedDate && (
              <div>
                <p className="font-data text-[10px] uppercase tracking-ultra text-oxford mb-1">
                  Anchor date
                </p>
                <p className="font-data text-sm text-emerald-600">{object.parsedDate}</p>
              </div>
            )}
            {object.body && (
              <div>
                <p className="font-data text-[10px] uppercase tracking-ultra text-oxford mb-1">
                  Body
                </p>
                <p className="font-data text-sm text-obsidian/70 leading-relaxed border border-amber-500/30 bg-amber-500/5 p-3">
                  {object.body}
                </p>
              </div>
            )}
            {object.explanation && (
              <div>
                <p className="font-data text-[10px] uppercase tracking-ultra text-oxford mb-1">
                  Explanation
                </p>
                <p className="font-data text-xs text-obsidian/55 italic leading-relaxed border-l-2 border-bone pl-3">
                  {object.explanation}
                </p>
              </div>
            )}
          </>
        )}

        {object.fileLabel && (
          <p className="font-data text-[10px] uppercase tracking-widest text-oxford/70">
            Source · {object.fileLabel}
          </p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-bone/40">
        {!object.isLocked && object.fileId && (
          <button
            type="button"
            onClick={() => onViewSource(object)}
            className="w-full font-data text-[10px] uppercase tracking-ultra border border-oxford/30 text-oxford px-4 py-3 hover:bg-oxford/5 mb-3"
          >
            View Source Document
          </button>
        )}
        <Link
          href="/switchboard"
          className="block text-center font-data text-[10px] uppercase tracking-ultra text-obsidian/40 hover:text-obsidian"
        >
          ← Switchboard
        </Link>
      </div>
    </aside>
  );
}
