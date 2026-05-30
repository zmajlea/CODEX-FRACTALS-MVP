"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { validateEncryptionKey } from "@/lib/encryption";
import { createClient } from "@/utils/supabase/client";
import type { VaultSummary } from "@/lib/types";

type EncryptionKeyModalProps = {
  vault: VaultSummary;
  currentKey: string | null;
  onSave: (key: string | null) => void;
  onClose: () => void;
};

export default function EncryptionKeyModal({
  vault,
  currentKey,
  onSave,
  onClose,
}: EncryptionKeyModalProps) {
  const [localKey, setLocalKey] = useState(currentKey || "");
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const lastValidatedKeyRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!localKey.trim()) {
      setKeyValid(null);
      lastValidatedKeyRef.current = "";
      return;
    }

    if (lastValidatedKeyRef.current === localKey && keyValid !== null) {
      return;
    }

    if (currentKey === localKey) {
      setKeyValid(true);
      lastValidatedKeyRef.current = localKey;
      return;
    }

    const timeoutId = setTimeout(async () => {
      setValidating(true);
      try {
        const isValid = await validateEncryptionKey(vault.id, localKey, supabase);
        setKeyValid(isValid);
        lastValidatedKeyRef.current = localKey;
      } catch {
        setKeyValid(false);
        lastValidatedKeyRef.current = localKey;
      } finally {
        setValidating(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validate on key/vault change only
  }, [localKey, vault.id, currentKey]);

  const handleUnlock = () => {
    if (!localKey.trim() || keyValid !== true) return;
    onSave(localKey);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-obsidian/40 backdrop-blur-sm flex justify-center items-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-vellum border border-bone w-full max-w-md mx-4 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-6">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              keyValid ? "bg-emerald pulse-emerald" : "bg-amber pulse-amber"
            }`}
          />
          <h2 className="font-head text-xl text-obsidian tracking-wide">
            Unlock Vault
          </h2>
        </div>

        <p className="font-data text-xs text-obsidian/60 mb-6 leading-relaxed">
          Enter the encryption key for{" "}
          <span className="text-obsidian font-medium">{vault.name}</span>. The
          key stays in this browser session only.
        </p>

        <div className="space-y-3">
          <label className="block font-data text-[10px] uppercase tracking-ultra text-obsidian/50">
            Encryption Key
          </label>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              placeholder="Enter vault key"
              className={`w-full border border-bone bg-vellum px-3 py-2.5 font-data text-sm outline-none focus:border-oxford ${
                localKey ? "pr-10" : ""
              } ${!showKey && localKey ? "text-transparent" : "text-obsidian"}`}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore="true"
            />
            {!showKey && localKey && (
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none font-data text-sm text-obsidian tracking-widest">
                {localKey.replace(/./g, "•")}
              </div>
            )}
            {localKey && (
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-obsidian/40 hover:text-obsidian text-xs font-data"
                tabIndex={-1}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 font-data text-[10px] uppercase tracking-wider">
            {validating && (
              <span className="text-obsidian/40">Validating…</span>
            )}
            {!validating && keyValid === true && localKey && (
              <span className="inline-flex items-center gap-2 text-emerald">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald pulse-emerald" />
                Emerald Pulse — Key Valid
              </span>
            )}
            {!validating && keyValid === false && localKey && (
              <span className="inline-flex items-center gap-2 text-cinnabar">
                <span className="w-1.5 h-1.5 rounded-full bg-cinnabar" />
                Invalid Key
              </span>
            )}
            {!validating && !localKey && (
              <span className="text-obsidian/30">Awaiting key</span>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center gap-3 mt-8 pt-6 border-t border-bone/50">
          {currentKey && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Forget this vault key for this session?"
                  )
                ) {
                  onSave(null);
                  onClose();
                }
              }}
              className="font-data text-[10px] uppercase tracking-wider text-cinnabar hover:text-cinnabar/80"
            >
              Forget Key
            </button>
          )}
          <div className="flex gap-3 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="font-data text-[10px] uppercase tracking-wider border border-bone px-4 py-2 text-obsidian/70 hover:bg-bone/20"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUnlock}
              disabled={validating || !localKey.trim() || keyValid !== true}
              className="font-data text-[10px] uppercase tracking-wider bg-oxford text-vellum px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-obsidian"
            >
              Unlock
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
