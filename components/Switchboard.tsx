import React from "react";

export type VaultEntity = {
  id: string;
  name: string;
  unlocked: boolean;
};

type SwitchboardProps = {
  vaults: VaultEntity[];
  onSelectVault: (vault: VaultEntity) => void;
  onCreateVault?: () => void;
  onGenerateVault?: () => void;
  activeVaultId?: string | null;
  generating?: boolean;
};

export default function Switchboard({
  vaults,
  onSelectVault,
  onCreateVault,
  onGenerateVault,
  activeVaultId,
  generating = false,
}: SwitchboardProps) {
  const isEmpty = vaults.length === 0;

  return (
    <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center bg-vellum px-6 py-16">
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".etched-card { " +
            "background-color: var(--vellum); " +
            "border: 1px solid var(--bone); " +
            "box-shadow: inset 1px 1px 2px rgba(0,0,0,0.05), inset -1px -1px 2px rgba(255,255,255,0.5); " +
            "transition: all 0.3s ease; " +
            "} " +
            ".etched-card:hover { " +
            "box-shadow: inset 2px 2px 5px rgba(0,0,0,0.1), inset -2px -2px 5px rgba(255,255,255,0.8); " +
            "transform: translateY(-2px); " +
            "} " +
            ".pulse-emerald { animation: pulse-emerald 2s ease-in-out infinite; } " +
            "@keyframes pulse-emerald { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); } 50% { box-shadow: 0 0 0 8px rgba(16,185,129,0); } }",
        }}
      />

      {isEmpty && onGenerateVault ? (
        <div className="w-full max-w-lg">
          <div className="etched-card rounded-premium px-10 py-12 text-center relative overflow-hidden">
            <div
              className="absolute inset-0 opacity-[0.04] pointer-events-none"
              aria-hidden
              style={{
                backgroundImage:
                  "repeating-radial-gradient(circle at 50% 50%, var(--obsidian) 0 1px, transparent 1px 24px)",
              }}
            />

            <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 mb-4">
              First 5 Minutes · Foundational Integrity
            </p>
            <h1 className="font-head text-3xl text-obsidian tracking-wide mb-4">
              Initialize Your Sovereign Archive
            </h1>
            <p className="font-data text-sm text-obsidian/55 leading-relaxed mb-8 max-w-md mx-auto">
              Create your first cryptographically sealed vault. Your keys will be
              generated locally and never leave this device.
            </p>

            <button
              type="button"
              onClick={onGenerateVault}
              disabled={generating}
              className="font-data text-[10px] uppercase tracking-ultra bg-oxford text-vellum px-8 py-3 hover:bg-oxford/90 transition-colors disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate Vault"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-12 w-full max-w-6xl">
          <div className="text-center space-y-3 font-head">
            <h1 className="text-4xl text-obsidian tracking-wide">The Switchboard</h1>
            <p className="text-obsidian/60 tracking-wider font-data text-sm">
              Locked vaults require your key. Unlocked vaults open your archive.
            </p>
          </div>

          <div className="flex flex-wrap gap-8 justify-center">
            {vaults.map((vault) => {
              const isActive = activeVaultId === vault.id;
              return (
                <button
                  key={vault.id}
                  type="button"
                  onClick={() => onSelectVault(vault)}
                  className={[
                    "etched-card w-72 h-80 flex flex-col items-center justify-center rounded-premium cursor-pointer outline-none relative group text-left",
                    isActive ? "ring-1 ring-emerald/40" : "",
                  ].join(" ")}
                >
                  <div
                    className={
                      "absolute top-6 right-6 w-2.5 h-2.5 rounded-full " +
                      (vault.unlocked
                        ? "bg-emerald-500 pulse-emerald"
                        : "bg-oxford/35 border border-oxford/50")
                    }
                    title={
                      vault.unlocked
                        ? "Unlocked — Emerald Pulse"
                        : "Locked — Grey Pulse"
                    }
                  />

                  <div className="absolute top-8 left-8 right-8 border-t border-bone/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute bottom-8 left-8 right-8 border-b border-bone/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <h2 className="font-head text-2xl mb-3 text-obsidian tracking-wide text-center px-4">
                    {vault.name}
                  </h2>

                  <span
                    className={
                      "font-data text-[10px] uppercase tracking-ultra px-4 py-2 mt-2 transition-colors " +
                      (vault.unlocked
                        ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/30"
                        : "text-oxford/70 bg-oxford/5 border border-oxford/20 group-hover:bg-oxford/10")
                    }
                  >
                    {vault.unlocked ? "Unlocked" : "Locked · Enter Key"}
                  </span>
                </button>
              );
            })}

            {onCreateVault && (
              <button
                type="button"
                onClick={onCreateVault}
                className="w-72 h-80 flex flex-col items-center justify-center rounded-premium border border-dashed border-bone/80 text-obsidian/40 hover:text-obsidian hover:border-oxford/40 transition-colors"
              >
                <span className="font-head text-4xl mb-2">+</span>
                <span className="font-data text-[10px] uppercase tracking-ultra">
                  New Vault
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
