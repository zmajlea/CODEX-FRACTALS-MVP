import React, { useEffect, useState } from "react";

type EvidenceMode = "clean" | "original" | "history";

type InspectorProps = {
  isOpen: boolean;
  pulseCoords: { x: number; y: number } | null;
  onClose: () => void;
  onSeal?: () => void | Promise<void>;
  pulseData?: {
    id: string;
    date: string;
    sourceDoc: string;
    clauseRaw: string;
    clauseContextFull: string;
  };
  recordName?: string;
  recordId?: string;
  isAlreadySealed?: boolean;
  readOnly?: boolean;
  hasEvidence?: boolean;
  pdfUrl?: string | null;
  pdfLoading?: boolean;
  insetLeftClass?: string;
  versionHistory?: { version: number; sealedAt: string | null; isCanonical: boolean }[];
};

export default function InspectorOverlay({
  isOpen,
  pulseCoords,
  onClose,
  onSeal,
  pulseData,
  recordName,
  recordId,
  isAlreadySealed,
  readOnly = false,
  hasEvidence = false,
  pdfUrl = null,
  pdfLoading = false,
  insetLeftClass = "left-16",
  versionHistory = [],
}: InspectorProps) {
  const [isSealing, setIsSealing] = useState(false);
  const [isSealed, setIsSealed] = useState(false);
  const [viewMode, setViewMode] = useState<EvidenceMode>("clean");
  const [sealId, setSealId] = useState("");
  const [sealDate, setSealDate] = useState("");
  const [sealError, setSealError] = useState<string | null>(null);

  useEffect(() => {
    if (readOnly && isOpen) setViewMode("original");
    if (isOpen) {
      setIsSealed(false);
      setSealError(null);
    }
  }, [readOnly, isOpen]);

  if (!isOpen) return null;

  const canSeal =
    !readOnly &&
    !isAlreadySealed &&
    !isSealed &&
    (hasEvidence ? Boolean(pdfUrl) : true);

  const handleSealClick = async () => {
    if (!canSeal || isSealing) return;
    setIsSealing(true);
    setSealError(null);
    try {
      await onSeal?.();
      setIsSealed(true);
      setSealId(pulseData?.id.slice(0, 8).toUpperCase() ?? "SEALED");
      setSealDate(new Date().toISOString().split("T")[0]);
      setTimeout(() => {
        setIsSealed(false);
        onClose();
      }, 1500);
    } catch (err) {
      setSealError(err instanceof Error ? err.message : "Seal failed");
    } finally {
      setIsSealing(false);
    }
  };

  return (
    <>
      {pulseCoords && !isSealed && (
        <svg
          className={`fixed top-16 ${insetLeftClass} right-0 bottom-0 w-full h-full pointer-events-none z-20`}
        >
          <line
            x1="50%"
            y1="50%"
            x2={pulseCoords.x}
            y2={pulseCoords.y}
            stroke="var(--bone)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            className="opacity-70"
          />
        </svg>
      )}

      <div
        className={`fixed top-16 ${insetLeftClass} right-0 bottom-0 z-30 flex items-center justify-center pointer-events-none`}
      >
        <div
          className={
            "pointer-events-auto bg-vellum/85 backdrop-blur-xl border border-bone w-full max-w-[1000px] h-[65vh] flex shadow-[0_20px_50px_rgba(0,0,0,0.1)] transition-all duration-500 " +
            (isSealed ? "scale-95 opacity-0" : "scale-100 opacity-100")
          }
        >
          <div className="w-1/2 border-r border-bone p-10 overflow-y-auto relative bg-bone/5">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-6 top-6 text-oxford hover:text-cinnabar z-50"
              title="Close (Esc)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className="flex justify-between items-center mb-8 border-b border-bone pb-4">
              <h3 className="font-head text-2xl text-obsidian">Evidence</h3>
              <div className="flex border border-bone rounded-sm overflow-hidden text-[9px] font-data uppercase tracking-widest font-bold">
                {(["clean", "original", "history"] as EvidenceMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={
                      "px-3 py-1.5 transition-colors " +
                      (viewMode === mode
                        ? "bg-obsidian text-vellum"
                        : "bg-transparent text-obsidian hover:bg-bone/40")
                    }
                  >
                    {mode === "clean"
                      ? "Clean"
                      : mode === "original"
                        ? "Original"
                        : "History"}
                  </button>
                ))}
              </div>
            </div>

            {viewMode === "history" ? (
              <div className="space-y-3">
                {versionHistory.length === 0 ? (
                  <p className="font-data text-sm text-obsidian/50">
                    No revision history for this pulse.
                  </p>
                ) : (
                  versionHistory.map((v) => (
                    <div
                      key={v.version}
                      className="border border-bone px-4 py-3 font-data text-xs"
                    >
                      v{v.version}{" "}
                      {v.isCanonical ? "· Canonical" : "· Superseded"}
                      {v.sealedAt && ` · ${v.sealedAt.slice(0, 10)}`}
                    </div>
                  ))
                )}
              </div>
            ) : viewMode === "clean" ? (
              <>
                {!hasEvidence && (
                  <p className="font-data text-xs text-amber-800 bg-amber/10 border border-amber/30 px-3 py-2 mb-4">
                    No evidence attached
                  </p>
                )}
                {pulseData?.clauseContextFull ? (
                  <p className="font-data text-sm leading-relaxed text-obsidian/85 whitespace-pre-line">
                    {pulseData.clauseContextFull}
                  </p>
                ) : (
                  <p className="font-data text-sm text-obsidian/50">
                    No clean text available.
                  </p>
                )}
              </>
            ) : pdfLoading ? (
              <div className="h-[400px] flex items-center justify-center font-data text-sm text-obsidian/50">
                Decrypting source document…
              </div>
            ) : pdfUrl ? (
              <iframe
                src={`${pdfUrl}#toolbar=1`}
                title="Decrypted source PDF"
                className="w-full h-[420px] border border-bone/50 bg-vellum"
              />
            ) : (
              <div className="h-[400px] flex items-center justify-center font-data text-sm text-obsidian/50 border border-bone/50">
                {hasEvidence
                  ? "Evidence required but not viewable."
                  : "No original document for this pulse."}
              </div>
            )}
          </div>

          <div className="w-1/2 p-10 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-baseline mb-8 border-b border-bone pb-4">
                <h3 className="font-head text-2xl text-obsidian">
                  {readOnly ? "Sealed Pulse" : "Pulse Detail"}
                </h3>
                <span className="font-data text-[10px] text-cinnabar px-2 py-1 border border-cinnabar/20 uppercase tracking-widest">
                  {isAlreadySealed || isSealed ? "Bone · Sealed" : "Amber · Candidate"}
                </span>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold">
                    Anchor Date
                  </label>
                  <div className="font-data text-lg mt-2 border-b border-dashed border-bone pb-1">
                    {pulseData?.date || "—"}
                  </div>
                </div>
                <div>
                  <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold">
                    Title
                  </label>
                  <div className="font-data text-sm mt-2 border-b border-dashed border-bone pb-1">
                    {pulseData?.clauseRaw || "—"}
                  </div>
                </div>
                <p className="font-data text-[10px] text-obsidian/40 uppercase tracking-widest">
                  Provenance: {pulseData?.sourceDoc} · {recordName}
                </p>
              </div>
            </div>

            {!readOnly && (
              <div className="mt-8">
                {sealError && (
                  <p className="font-data text-xs text-cinnabar mb-3">{sealError}</p>
                )}
                {!hasEvidence && (
                  <p className="font-data text-[10px] text-obsidian/50 mb-3 text-center uppercase tracking-widest">
                    Native pulse — no evidence attached
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleSealClick}
                  disabled={!canSeal || isSealing || isAlreadySealed}
                  className={
                    "w-full py-4 font-data text-sm uppercase tracking-[0.2em] font-bold transition-all " +
                    (isAlreadySealed || isSealed
                      ? "bg-bone text-oxford/50 shadow-inner pointer-events-none"
                      : canSeal
                        ? "bg-cinnabar text-vellum hover:shadow-[0_0_15px_rgba(230,126,80,0.4)]"
                        : "bg-bone/50 text-obsidian/40 cursor-not-allowed")
                  }
                >
                  {isSealing
                    ? "Sealing…"
                    : isAlreadySealed || isSealed
                      ? "Anchored"
                      : "Seal Pulse"}
                </button>
                {(isSealed || isAlreadySealed) && (
                  <p className="mt-4 font-data text-[10px] text-oxford uppercase text-center">
                    SEALED {sealDate} · {sealId || recordId?.slice(0, 8)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
