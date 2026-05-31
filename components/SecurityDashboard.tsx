import React from 'react';

type SecurityDashboardProps = {
  isOpen: boolean;
  onClose: () => void;
  recordName: string;
  unlockedVaultCount?: number;
  totalVaultCount?: number;
};

export default function SecurityDashboard({
  isOpen,
  onClose,
  recordName,
  unlockedVaultCount = 0,
  totalVaultCount = 0,
}: SecurityDashboardProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end pt-20 pr-12 pointer-events-none">
      <div 
        className={"pointer-events-auto bg-vellum/90 backdrop-blur-xl border border-bone w-[420px] shadow-[0_20px_60px_rgba(0,0,0,0.08)] transition-all duration-500 " + (isOpen ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0")}
      >
        <div className="flex justify-between items-center p-6 border-b border-bone/50">
          <div>
            <h3 className="font-head text-lg text-obsidian tracking-wide">
              Randall Trust Protocol
            </h3>
            <p className="font-data text-[9px] uppercase tracking-widest text-obsidian/40 mt-1">
              Security Dashboard
            </p>
          </div>
          <button onClick={onClose} className="text-obsidian/50 hover:text-obsidian transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        
        <div className="p-8 space-y-10 font-data">
          
          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-obsidian/40 mb-3">
              Active Domain
            </div>
            <div className="bg-bone/30 px-3 py-2 border border-bone flex items-center gap-3 w-fit">
              <span
                className={
                  "w-1.5 h-1.5 rounded-full " +
                  (unlockedVaultCount > 0 ? "bg-emerald-500" : "bg-oxford/50")
                }
              />
              <span className="text-xs font-bold text-obsidian uppercase tracking-wider">
                {recordName}
              </span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-5">
              <svg
                className="w-5 h-5 text-oxford mt-1"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-oxford mb-1.5">
                  Record Integrity
                </div>
                <div className="text-[11px] text-obsidian/60 tracking-wide leading-relaxed font-bold">
                  {unlockedVaultCount > 0 ? "Key-Protected" : "Locked"}
                </div>
                <div className="text-[9px] text-obsidian/40 tracking-wider uppercase mt-1">
                  {unlockedVaultCount} of {totalVaultCount} vault
                  {totalVaultCount === 1 ? "" : "s"} unlocked this session
                </div>
              </div>
            </div>

            <div className="flex items-start gap-5">
              <svg className="w-5 h-5 text-obsidian mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-obsidian mb-1.5">
                  AI Mode
                </div>
                <div className="text-[11px] text-obsidian/60 tracking-wide leading-relaxed">
                  Private / Stateless (Gemini Rails)
                </div>
                <div className="text-[9px] text-obsidian/40 tracking-wider uppercase mt-1">
                  Processed per-request · no memory between sessions
                </div>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-bone/50 text-[9px] uppercase tracking-[0.1em] text-obsidian/40 font-bold">
            Verified by FractalsOS
          </div>

        </div>
      </div>
    </div>
  );
}
