"use client";

import React, { useEffect, useState } from "react";
import HankoSeal from "@/components/HankoSeal";
import {
  INTELLIGENCE_LENSES,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";
import type { TriageSuggestion } from "@/lib/temporal/seal-batch";

type SealPhase = "idle" | "review" | "signing" | "success";

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
  onSealBatch: () => Promise<void>;
  onSealSuccess?: () => void;
  sealerInitials?: string;
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
  onSealSuccess,
  sealerInitials = "FR",
  onClose,
  activeLensId,
  onLensChange,
  customPrompt,
  onCustomPromptChange,
}: TriageInspectorOverlayProps) {
  const [sealPhase, setSealPhase] = useState<SealPhase>("idle");
  const [sealError, setSealError] = useState<string | null>(null);

  const active =
    suggestions.find((s) => s.id === activeSuggestionId) ?? suggestions[0] ?? null;

  useEffect(() => {
    if (!isOpen) {
      setSealPhase("idle");
      setSealError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (sealPhase !== "success") return;
    const timer = window.setTimeout(() => {
      onSealSuccess?.();
      setSealPhase("idle");
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [sealPhase, onSealSuccess]);

  const handleReviewAndSeal = () => {
    if (suggestions.length === 0) return;
    setSealError(null);
    setSealPhase("review");
  };

  const handleConfirmSeal = async () => {
    if (sealPhase === "signing" || suggestions.length === 0) return;
    setSealPhase("signing");
    setSealError(null);
    try {
      await onSealBatch();
      setSealPhase("success");
    } catch (err) {
      setSealError(err instanceof Error ? err.message : "Seal batch failed");
      setSealPhase("review");
    }
  };

  const cancelReview = () => {
    if (sealPhase === "signing") return;
    setSealPhase("idle");
    setSealError(null);
  };

  if (!isOpen) return null;

  const isSigning = sealPhase === "signing";
  const showReviewPanel = sealPhase === "review" || sealPhase === "signing";

  return (
    <div className="fixed inset-0 z-50 bg-obsidian/30 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="relative bg-vellum/95 border border-bone w-full max-w-6xl h-[85vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.15)] overflow-hidden">
        {sealPhase === "success" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-vellum/95 backdrop-blur-md">
            <span
              className="w-5 h-5 rounded-full bg-emerald-500 pulse-emerald mb-6"
              aria-hidden
            />
            <p className="font-head text-2xl text-obsidian tracking-wide">
              Batch Sealed to Ledger.
            </p>
            <p className="font-data text-[10px] uppercase tracking-ultra text-emerald-500/80 mt-3">
              Cryptographic commitment recorded
            </p>
          </div>
        )}

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
              onClick={handleReviewAndSeal}
              disabled={
                suggestions.length === 0 ||
                isSigning ||
                sealPhase === "success" ||
                showReviewPanel
              }
              className="font-data text-[10px] uppercase tracking-ultra bg-oxford text-vellum px-4 py-2 disabled:opacity-40"
            >
              Review &amp; Seal
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSigning}
              className="text-obsidian/50 hover:text-obsidian disabled:opacity-30"
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
              disabled={isSigning}
              className={[
                "font-data text-[10px] uppercase tracking-wider px-3 py-1.5 border transition-colors disabled:opacity-40",
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
              disabled={isSigning}
              className="w-full border border-bone bg-vellum px-3 py-2 font-data text-sm text-obsidian outline-none focus:border-oxford disabled:opacity-50"
            />
          </div>
        )}

        <div
          className={
            "flex flex-1 min-h-0 transition-opacity duration-300 " +
            (showReviewPanel ? "opacity-40 pointer-events-none" : "")
          }
        >
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
                          active?.id === s.id
                            ? "bg-amber/10 border-l-2 border-l-amber"
                            : "",
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

        {showReviewPanel && (
          <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-bone bg-vellum/98 backdrop-blur-xl seal-panel-enter shadow-[0_-20px_40px_rgba(0,0,0,0.06)]">
            <div className="px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <HankoSeal
                  initials={sealerInitials}
                  size="lg"
                  onClick={() => void handleConfirmSeal()}
                  disabled={isSigning}
                  title="Press Hanko to seal batch"
                />
                <div>
                  <p className="font-head text-lg text-obsidian tracking-wide">
                    {isSigning
                      ? `Cryptographically signing ${suggestions.length} object${suggestions.length === 1 ? "" : "s"}…`
                      : `Confirm seal of ${suggestions.length} object${suggestions.length === 1 ? "" : "s"}`}
                  </p>
                  <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/45 mt-1">
                    {isSigning
                      ? "Encrypting client-side · writing to ledger"
                      : "Press the Hanko or confirm to commit to the vault"}
                  </p>
                  {sealError && (
                    <p className="font-data text-xs text-cinnabar mt-2">{sealError}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={cancelReview}
                  disabled={isSigning}
                  className="font-data text-[10px] uppercase tracking-ultra border border-bone px-4 py-2 hover:bg-bone/20 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmSeal()}
                  disabled={isSigning}
                  className="font-data text-[10px] uppercase tracking-ultra bg-cinnabar text-vellum px-5 py-2.5 hover:bg-cinnabar/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSigning ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-vellum animate-pulse" />
                      Signing…
                    </>
                  ) : (
                    "Confirm Seal"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
