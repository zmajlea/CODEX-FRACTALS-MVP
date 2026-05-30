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
  activeVaultId?: string | null;
};

export default function Switchboard({
  vaults,
  onSelectVault,
  onCreateVault,
  activeVaultId,
}: SwitchboardProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-vellum px-6 py-16">
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
            ".pulse-amber { animation: pulse-amber 2s ease-in-out infinite; } " +
            ".pulse-emerald { animation: pulse-emerald 2s ease-in-out infinite; } " +
            "@keyframes pulse-amber { 0%, 100% { box-shadow: 0 0 0 0 rgba(235,192,109,0.4); } 50% { box-shadow: 0 0 0 6px rgba(235,192,109,0); } } " +
            "@keyframes pulse-emerald { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); } 50% { box-shadow: 0 0 0 8px rgba(16,185,129,0); } }",
        }}
      />

      <div className="flex flex-col items-center gap-12 w-full max-w-6xl">
        <div className="text-center space-y-3 font-head">
          <h1 className="text-4xl text-obsidian tracking-wide">The Switchboard</h1>
          <p className="text-obsidian/60 tracking-wider font-data text-sm">
            Select a vault to unlock. Keys never leave this session.
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
                  className={`absolute top-6 right-6 w-2.5 h-2.5 rounded-full ${
                    vault.unlocked
                      ? "bg-emerald pulse-emerald"
                      : "bg-amber pulse-amber"
                  }`}
                  title={
                    vault.unlocked ? "Unlocked — Emerald Pulse" : "Locked — Amber Pulse"
                  }
                />

                <div className="absolute top-8 left-8 right-8 border-t border-bone/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute bottom-8 left-8 right-8 border-b border-bone/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                <h2 className="font-head text-2xl mb-3 text-obsidian tracking-wide text-center px-4">
                  {vault.name}
                </h2>

                <span
                  className={`font-data text-[10px] uppercase tracking-ultra px-4 py-2 mt-2 transition-colors ${
                    vault.unlocked
                      ? "text-emerald bg-emerald/10 border border-emerald/30"
                      : "text-oxford bg-bone/20 group-hover:bg-bone/40"
                  }`}
                >
                  {vault.unlocked ? "Unlocked" : "Enter Key"}
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

        {vaults.length === 0 && (
          <p className="font-data text-sm text-obsidian/50">
            No vaults yet. Create your first vault to begin.
          </p>
        )}
      </div>
    </div>
  );
}
