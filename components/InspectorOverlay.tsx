import React, { useEffect, useState } from 'react';

type InspectorProps = {
  isOpen: boolean;
  pulseCoords: { x: number, y: number } | null;
  onClose: () => void;
  onSeal?: () => void;
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
  pdfUrl?: string | null;
  pdfLoading?: boolean;
  insetLeftClass?: string;
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
  pdfUrl = null,
  pdfLoading = false,
  insetLeftClass = "left-16",
}: InspectorProps) {
  const [isSealing, setIsSealing] = useState(false);
  const [isSealed, setIsSealed] = useState(false);
  const [viewMode, setViewMode] = useState<'text' | 'pdf'>('text');
  const [sealId, setSealId] = useState('');
  const [sealDate, setSealDate] = useState('');
  
  useEffect(() => {
    if (readOnly && isOpen) {
      setViewMode("pdf");
    }
  }, [readOnly, isOpen]);

  if (!isOpen) return null;

    const handleSealClick = () => {
    setIsSealing(true);
    // Simulate the shudder timeline
    setTimeout(() => {
      setIsSealing(false);
      setIsSealed(true);
      setSealId(Math.random().toString(36).substring(2, 10).toUpperCase());
      setSealDate(new Date().toISOString().split('T')[0]);
      // Wait for user to read the stamp before closing the modal
      setTimeout(() => {
        onSeal?.();
        setIsSealed(false);
      }, 1500);
    }, 800);
  };

  return (
    <>
      {/* TETHER LINE SVG */}
      {pulseCoords && !isSealed && (
        <svg className={`fixed top-16 ${insetLeftClass} right-0 bottom-0 w-full h-full pointer-events-none z-20 transition-opacity duration-300`}>
          <line 
            x1="50%" y1="50%" 
            x2={pulseCoords.x} y2={pulseCoords.y} 
            stroke="var(--bone)" 
            strokeWidth="1.5" 
            strokeDasharray="4 4"
            className="opacity-70 animate-pulse"
          />
        </svg>
      )}

      {/* INSPECTOR MODAL */}
      <div className={`fixed top-16 ${insetLeftClass} right-0 bottom-0 z-30 flex items-center justify-center pointer-events-none`}>
        <div className={"pointer-events-auto bg-vellum/85 backdrop-blur-xl border border-bone w-full max-w-[1000px] h-[65vh] flex shadow-[0_20px_50px_rgba(0,0,0,0.1)] transition-all duration-500 ease-out " + (isSealed ? "scale-95 opacity-0" : "scale-100 opacity-100")}>
          
          {/* LEFT: SOURCE READER */}
          <div className="w-1/2 border-r border-bone p-10 overflow-y-auto custom-scrollbar relative bg-bone/5">
            <button onClick={onClose} className="absolute right-6 top-6 text-oxford hover:text-cinnabar transition-colors z-50" title="Close">
               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            <div className="flex justify-between items-center mb-8 border-b border-bone pb-4">
              <h3 className="font-head text-2xl text-obsidian tracking-wide">Source Document</h3>
              <div className="flex border border-bone rounded-sm overflow-hidden text-[9px] font-data uppercase tracking-widest font-bold">
                <button 
                  onClick={() => setViewMode('text')}
                  className={"px-3 py-1.5 transition-colors " + (viewMode === 'text' ? "bg-obsidian text-vellum" : "bg-transparent text-obsidian hover:bg-bone/40")}
                >
                  Clean Text
                </button>
                <button 
                  onClick={() => setViewMode('pdf')}
                  className={"px-3 py-1.5 transition-colors " + (viewMode === 'pdf' ? "bg-obsidian text-vellum" : "bg-transparent text-obsidian hover:bg-bone/40")}
                >
                  Original Document
                </button>
              </div>
            </div>
            
            {viewMode === "text" ? (
              <>
                <div className="mb-6 flex justify-between bg-bone/30 px-3 py-2 rounded-sm border border-bone/50">
                  <span className="font-data text-xs text-oxford uppercase tracking-widest font-semibold flex items-center gap-2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    {pulseData?.sourceDoc || recordName || "Document"}
                  </span>
                </div>

                {pulseData?.clauseContextFull ? (
                  <p className="font-data text-sm leading-[2.2] text-obsidian/85 mt-4 whitespace-pre-line">
                    {pulseData.clauseContextFull
                      .split(pulseData.clauseRaw || "")
                      .map((part, index, arr) => (
                        <React.Fragment key={index}>
                          {part}
                          {index < arr.length - 1 && (
                            <mark className="bg-[#EBC06D]/30 text-obsidian px-2 py-1 rounded cursor-grab shadow-sm border border-[#EBC06D]/50 transition-colors hover:bg-[#EBC06D]/50">
                              {pulseData.clauseRaw}
                            </mark>
                          )}
                        </React.Fragment>
                      ))}
                  </p>
                ) : (
                  <p className="font-data text-sm text-obsidian/50 mt-4">
                    Open the Original Document tab to view the E2E decrypted PDF.
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
              <div className="h-[400px] flex items-center justify-center font-data text-sm text-obsidian/50 border border-bone/50 bg-bone/10">
                No decrypted PDF available for this record.
              </div>
            )}
          </div>

          {/* RIGHT: THE PULSE CARD */}
          <div className="w-1/2 p-10 flex flex-col justify-between relative">
            <div>
              <div className="flex justify-between items-baseline mb-8 border-b border-bone pb-4">
                <h3 className="font-head text-2xl text-obsidian tracking-wide">
                  {readOnly ? "Sovereign Record" : "Pulse Detail"}
                </h3>
                <span className="font-data text-[10px] text-[#E67E50] px-2 py-1 border border-[#E67E50]/20 uppercase tracking-widest font-bold shadow-sm bg-[#E67E50]/5">
                  {readOnly
                    ? "Key-Protected View"
                    : isAlreadySealed
                      ? "Sealed • Result"
                      : isSealed
                        ? "Sealed"
                        : "Unsealed • Focus"}
                </span>
              </div>

              {readOnly ? (
                <div className="space-y-6">
                  <div>
                    <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold">
                      Record
                    </label>
                    <div className="font-data text-lg mt-2 text-obsidian">
                      {recordName}
                    </div>
                  </div>
                  {recordId && (
                    <div>
                      <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold">
                        Record ID
                      </label>
                      <div className="font-data text-[11px] mt-2 text-obsidian/60 break-all">
                        {recordId}
                      </div>
                    </div>
                  )}
                  <p className="font-data text-xs text-obsidian/50 leading-relaxed border-l-2 border-bone pl-3">
                    Sovereign isolation active. This view is scoped to the selected
                    document hub only.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  <div>
                    <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold">
                      Anchor Date
                    </label>
                    <div className="font-data text-lg mt-2 text-obsidian">
                      {pulseData?.date || "..."}
                    </div>
                  </div>
                  <div>
                    <label className="font-data text-xs text-oxford uppercase tracking-widest font-bold flex justify-between">
                      <span>Source Clause</span>
                    </label>
                    <div className="font-data text-[13px] mt-2 border border-[#EBC06D]/60 bg-[#EBC06D]/10 p-5 leading-relaxed text-obsidian shadow-inner relative">
                      <div className="absolute top-0 left-0 w-1 h-full bg-[#EBC06D]" />
                      &quot;{pulseData?.clauseRaw}&quot;
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!readOnly && (
              <div className="mt-8 flex flex-col items-center">
                {!isAlreadySealed && !isSealed && (
                  <div className="font-data text-[10px] uppercase tracking-widest text-obsidian/40 mb-3 w-full text-center">
                    Anchoring to: {recordName}
                  </div>
                )}

                <button
                  onMouseDown={() => setIsSealing(true)}
                  onClick={handleSealClick}
                  onMouseLeave={() => setIsSealing(false)}
                  disabled={isSealed || isSealing || isAlreadySealed}
                  className={
                    "relative overflow-hidden w-full py-4 px-8 font-data text-sm uppercase tracking-[0.2em] font-bold transition-all duration-300 " +
                    (isSealed || isAlreadySealed
                      ? "bg-bone text-oxford/50 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-1px_-1px_3px_rgba(255,255,255,0.7)] pointer-events-none border border-black/5"
                      : isSealing
                        ? "bg-[#cd5b2a] text-vellum shadow-[0_0_30px_rgba(230,126,80,0.8)] scale-[0.98]"
                        : "bg-[#E67E50] text-vellum shadow-[0_0_15px_rgba(230,126,80,0.4)] hover:shadow-[0_0_20px_rgba(230,126,80,0.6)] cursor-pointer")
                  }
                >
                  {isSealed || isAlreadySealed ? "Anchored" : "Seal Pulse"}
                </button>

                <div
                  className={
                    "mt-5 font-data text-[10px] text-oxford tracking-[0.1em] transition-opacity duration-500 " +
                    (isSealed || isAlreadySealed ? "opacity-100" : "opacity-0")
                  }
                >
                  <span className="flex items-center gap-2 font-bold uppercase">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    SEALED: {sealDate || "2026-04-12"} | SEAL ID:{" "}
                    {sealId || "A9B26F"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
