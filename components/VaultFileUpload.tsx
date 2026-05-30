"use client";

import { useCallback, useRef, useState } from "react";
import { uploadEncryptedFile } from "@/lib/files/upload-encrypted-file";
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
  const [lastFile, setLastFile] = useState<string | null>(null);
  const supabase = createClient();

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;

      const sessionKey = getVaultSessionKey(vaultId);
      if (!sessionKey) {
        setError("Vault is locked. Unlock it before uploading.");
        return;
      }

      setUploading(true);
      setError(null);

      try {
        for (const file of Array.from(files)) {
          const result = await uploadEncryptedFile(supabase, {
            vaultId,
            recordId,
            file,
          });
          setLastFile(result.fileId);
          onUploaded?.(result.fileId);
        }
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
        Files are encrypted in your browser before upload. Supabase only stores
        ciphertext.
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
          className="sr-only"
          disabled={uploading || locked}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <span className="font-data text-[10px] uppercase tracking-ultra text-obsidian/60">
          {uploading ? "Encrypting & uploading…" : "Drop file or click to browse"}
        </span>
      </label>

      {error && (
        <p className="mt-3 font-data text-xs text-cinnabar">{error}</p>
      )}
      {lastFile && !error && (
        <p className="mt-3 font-data text-[10px] uppercase tracking-wider text-emerald">
          Uploaded · {lastFile.slice(0, 8)}…
        </p>
      )}
    </div>
  );
}
