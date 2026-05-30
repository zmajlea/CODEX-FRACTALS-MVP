"use client";

import React from "react";
import {
  INTELLIGENCE_LENSES,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";
import type { TriageSuggestion } from "@/lib/temporal/seal-batch";

type TriageInspectorOverlayProps = {
  isOpen: boolean;
  pdfUrl: string | null;
  pdfLoading?: boolean;
  pdfError?: string | null;
  fileName?: string;
  suggestions: TriageSuggestion[];
  activeSuggestionId: string | null;
  onSelectSuggestion: (id: string) => void;
  onUpdateSuggestion: (
    id: string,
    patch: Partial<
      Pick<TriageSuggestion, "title" | "body" | "category" | "explanation" | "parsedDate">
    >
  ) => void;
  onRemoveSuggestion: (id: string) => void;
  onSealBatch: () => void;
  sealing?: boolean;
  onClose: () => void;
  activeLensId: IntelligenceLensId;
  onLensChange: (id: IntelligenceLensId) => void;
  customPrompt: string;
  onCustomPromptChange: (value: string) => void;
};

export default function TriageInspectorOverlay({
  isOpen,
  pdfUrl,
  pdfLoading,
  pdfError,
  fileName,
  suggestions,
  activeSuggestionId,
  onSelectSuggestion,
  onUpdateSuggestion,
  onRemoveSuggestion,
  onSealBatch,
  sealing,
  onClose,
  activeLensId,
  onLensChange,
  customPrompt,
  onCustomPromptChange,
}: TriageInspectorOverlayProps) {
  const active =
    suggestions.find((s) => s.id === activeSuggestionId) ?? suggestions[0] ?? null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-obsidian/30 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-vellum/95 border border-bone w-full max-w-6xl h-[85vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
        <header className="flex items-center justify-between px-6 py-4 border-b border-bone shrink-0">
          <div>
            <h2 className="font-head text-xl text-obsidian tracking-wide">
              Triage Workspace
            </h2>
            <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 mt-1">
              {fileName ?? "Select a file"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSealBatch}
              disabled={sealing || suggestions.length === 0}
              className="font-data text-[10px] uppercase tracking-ultra bg-oxford text-vellum px-4 py-2 disabled:opacity-40"
            >
              {sealing ? "Sealing…" : "Seal Batch"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-obsidian/50 hover:text-obsidian"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="px-6 py-3 border-b border-bone/60 flex flex-wrap gap-2 shrink-0">
          <span className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 self-center mr-2">
            Intelligence lenses
          </span>
          {INTELLIGENCE_LENSES.map((lens) => (
            <button
              key={lens.id}
              type="button"
              onClick={() => onLensChange(lens.id)}
              className={[
                "font-data text-[10px] uppercase tracking-wider px-3 py-1.5 border transition-colors",
                activeLensId === lens.id
                  ? "bg-obsidian text-vellum border-obsidian"
                  : "bg-vellum text-obsidian border-bone hover:bg-bone/30",
              ].join(" ")}
            >
              {lens.icon} {lens.label}
            </button>
          ))}
        </div>

        {activeLensId === "custom" && (
          <div className="px-6 py-3 border-b border-bone/40 shrink-0">
            <textarea
              value={customPrompt}
              onChange={(e) => onCustomPromptChange(e.target.value)}
              rows={2}
              placeholder="Custom extraction instructions…"
              className="w-full border border-bone bg-vellum px-3 py-2 font-data text-sm text-obsidian outline-none focus:border-oxford"
            />
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* LEFT: decrypted PDF */}
          <div className="w-1/2 border-r border-bone flex flex-col min-h-0 bg-bone/5">
            <div className="px-6 py-3 border-b border-bone/50 shrink-0">
              <h3 className="font-head text-lg text-obsidian">Source Document</h3>
              <p className="font-data text-[10px] text-obsidian/40 uppercase tracking-wider mt-1">
                E2E decrypted in browser
              </p>
            </div>
            <div className="flex-1 min-h-0">
              {pdfLoading && (
                <div className="h-full flex items-center justify-center font-data text-sm text-obsidian/50">
                  Decrypting PDF…
                </div>
              )}
              {!pdfLoading && pdfUrl && (
                <iframe
                  src={`${pdfUrl}#toolbar=1`}
                  title="Decrypted PDF"
                  className="w-full h-full border-0"
                />
              )}
              {!pdfLoading && !pdfUrl && (
                <div className="h-full flex items-center justify-center font-data text-sm text-obsidian/50 px-6 text-center">
                  {pdfError ?? "Select a file to preview."}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: AI extraction triage */}
          <div className="w-1/2 flex flex-col min-h-0">
            <div className="px-6 py-3 border-b border-bone/50 shrink-0 flex justify-between items-center">
              <h3 className="font-head text-lg text-obsidian">Extraction Results</h3>
              <span className="font-data text-[10px] text-cinnabar uppercase tracking-widest border border-cinnabar/30 px-2 py-1 bg-cinnabar/5">
                Unsealed · Triage
              </span>
            </div>

            <div className="flex flex-1 min-h-0">
              <ul className="w-2/5 border-r border-bone/40 overflow-y-auto">
                {suggestions.length === 0 ? (
                  <li className="p-4 font-data text-xs text-obsidian/40">
                    Run extraction to populate results.
                  </li>
                ) : (
                  suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onSelectSuggestion(s.id)}
                        className={[
                          "w-full text-left px-4 py-3 border-b border-bone/30 hover:bg-bone/20",
                          active?.id === s.id ? "bg-amber/10 border-l-2 border-l-amber" : "",
                        ].join(" ")}
                      >
                        <div className="font-head text-sm text-obsidian truncate">
                          {s.title}
                        </div>
                        <div className="font-data text-[10px] text-obsidian/50 uppercase mt-1">
                          {s.category}
                          {s.parsedDate ? ` · ${s.parsedDate}` : ""}
                        </div>
                      </button>
                    </li>
                  ))
                )}
              </ul>

              <div className="flex-1 overflow-y-auto p-6">
                {active ? (
                  <div className="space-y-5">
                    <div>
                      <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
                        Title
                      </label>
                      <input
                        value={active.title}
                        onChange={(e) =>
                          onUpdateSuggestion(active.id, { title: e.target.value })
                        }
                        className="mt-1 w-full border-b border-bone bg-transparent py-2 font-head text-lg outline-none focus:border-oxford"
                      />
                    </div>
                    <div>
                      <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
                        Anchor date
                      </label>
                      <input
                        type="date"
                        value={active.parsedDate}
                        onChange={(e) =>
                          onUpdateSuggestion(active.id, {
                            parsedDate: e.target.value,
                          })
                        }
                        className="mt-1 w-full border border-bone bg-vellum px-3 py-2 font-data text-sm outline-none focus:border-oxford"
                      />
                    </div>
                    <div>
                      <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
                        Category
                      </label>
                      <input
                        value={active.category}
                        onChange={(e) =>
                          onUpdateSuggestion(active.id, {
                            category: e.target.value,
                          })
                        }
                        className="mt-1 w-full border-b border-bone bg-transparent py-2 font-data text-xs uppercase tracking-wider outline-none"
                      />
                    </div>
                    <div>
                      <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
                        Source clause
                      </label>
                      <textarea
                        value={active.body}
                        onChange={(e) =>
                          onUpdateSuggestion(active.id, { body: e.target.value })
                        }
                        rows={5}
                        className="mt-1 w-full border border-amber/40 bg-amber/5 p-3 font-data text-sm leading-relaxed outline-none focus:border-amber"
                      />
                    </div>
                    <div>
                      <label className="font-data text-[10px] uppercase tracking-ultra text-oxford">
                        Explanation
                      </label>
                      <textarea
                        value={active.explanation}
                        onChange={(e) =>
                          onUpdateSuggestion(active.id, {
                            explanation: e.target.value,
                          })
                        }
                        rows={3}
                        className="mt-1 w-full border border-bone bg-transparent p-2 font-data text-xs outline-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => onRemoveSuggestion(active.id)}
                        className="font-data text-[10px] uppercase tracking-wider text-cinnabar px-3 py-2"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="font-data text-sm text-obsidian/40">
                    Select an extraction to edit before sealing.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
