"use client";

import { useCallback, useRef, useState } from "react";
import { uploadEncryptedFile } from "@/lib/files/upload-encrypted-file";
import {
  ACCEPT_FILE_TYPES,
  isSupportedUpload,
  shouldSkipFileName,
} from "@/lib/files/supported-formats";
import { createClient } from "@/utils/supabase/client";
import { getVaultSessionKey } from "@/lib/vault-session";

type VaultFileUploadProps = {
  vaultId: string;
  recordId: string;
  onUploaded?: (fileId: string) => void;
};

export default function VaultFileUpload({
  vaultId,
  recordId,
  onUploaded,
}: VaultFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState(0);
  const supabase = createClient();

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;

      const sessionKey = getVaultSessionKey(vaultId);
      if (!sessionKey) {
        setError("Vault is locked. Unlock it before uploading.");
        return;
      }

      const candidates = Array.from(files).filter(
        (f) => !shouldSkipFileName(f.name)
      );
      const unsupported = candidates.filter((f) => !isSupportedUpload(f));
      if (unsupported.length > 0) {
        setError(
          `Unsupported: ${unsupported.map((f) => f.name).join(", ")}. Use PDF, CSV, MD, TXT, HTML, XLSX, or DOCX.`
        );
        return;
      }
      if (candidates.length === 0) {
        setError("No supported files selected.");
        return;
      }

      setUploading(true);
      setError(null);

      try {
        let uploaded = 0;
        for (const file of candidates) {
          const result = await uploadEncryptedFile(supabase, {
            vaultId,
            recordId,
            file,
          });
          uploaded += 1;
          onUploaded?.(result.fileId);
        }
        setLastCount(uploaded);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [vaultId, recordId, supabase, onUploaded]
  );

  const locked = !getVaultSessionKey(vaultId);

  return (
    <div className="border border-bone bg-vellum/80 p-6 w-full max-w-xl">
      <div className="flex items-center gap-3 mb-4">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            locked ? "bg-amber pulse-amber" : "bg-emerald pulse-emerald"
          }`}
        />
        <h3 className="font-head text-lg text-obsidian">Secure Upload</h3>
      </div>

      <p className="font-data text-xs text-obsidian/50 mb-4 leading-relaxed">
        PDF, CSV, MD, TXT, HTML, XLSX, DOCX — encrypted in your browser before
        upload. Supabase only stores ciphertext.
      </p>

      <label
        className={[
          "flex flex-col items-center justify-center gap-3 border border-dashed border-bone px-6 py-10 cursor-pointer transition-colors",
          locked
            ? "opacity-50 cursor-not-allowed"
            : "hover:border-emerald/40 hover:bg-emerald/5",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_FILE_TYPES}
          className="sr-only"
          disabled={uploading || locked}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <span className="font-data text-[10px] uppercase tracking-ultra text-obsidian/60">
          {uploading
            ? "Encrypting & uploading…"
            : "Drop files or click to browse (multi-select)"}
        </span>
      </label>

      {error && (
        <p className="mt-3 font-data text-xs text-cinnabar">{error}</p>
      )}
      {lastCount > 0 && !error && (
        <p className="mt-3 font-data text-[10px] uppercase tracking-wider text-emerald">
          Uploaded {lastCount} file{lastCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
