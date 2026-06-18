"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import TriageInspectorOverlay from "@/components/TriageInspectorOverlay";
import { extractTextFromFile } from "@/lib/file-text-extraction";
import { loadDecryptedFileNames } from "@/lib/files/decrypt-file-name";
import { downloadDecryptedFileBlob } from "@/lib/files/download-decrypted-file";
import {
  isExtractable,
  resolveFileFormat,
} from "@/lib/files/supported-formats";
import {
  getLensPrompt,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";
import { inferParsedDate } from "@/lib/temporal/parse-date";
import { composeLabel } from "@/lib/temporal/event-types";
import {
  sealTemporalBatch,
  type TriageSuggestion,
} from "@/lib/temporal/seal-batch";
import type { VaultFileRow } from "@/lib/types";
import { getVaultSessionKey } from "@/lib/vault-session";
import { createClient } from "@/utils/supabase/client";

const PREVIEW_CHAR_LIMIT = 120_000;

export default function VaultExtractPage() {
  const params = useParams<{ vaultId: string }>();
  const vaultId = params.vaultId;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [files, setFiles] = useState<VaultFileRow[]>([]);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"pdf" | "text">("pdf");
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [sealerInitials, setSealerInitials] = useState("FR");

  const [activeLensId, setActiveLensId] =
    useState<IntelligenceLensId>("commercial");
  const [customPrompt, setCustomPrompt] = useState("");

  const [suggestions, setSuggestions] = useState<TriageSuggestion[]>([]);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(
    null
  );

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;
  const selectedFileName =
    (selectedFileId && fileNames[selectedFileId]) ||
    selectedFile?.id.slice(0, 8) ||
    "";
  const selectedFormat = selectedFile
    ? resolveFileFormat(selectedFileName, selectedFile.mime_type)
    : null;
  const canExtract = selectedFile
    ? isExtractable(selectedFileName, selectedFile.mime_type)
    : false;

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!getVaultSessionKey(vaultId)) {
      router.push(`/switchboard?vault=${vaultId}`);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("files")
      .select(
        "id, vault_id, record_id, storage_path, mime_type, encrypted, file_name_ciphertext, created_at"
      )
      .eq("vault_id", vaultId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as VaultFileRow[];
    setFiles(rows);
    setFileNames(await loadDecryptedFileNames(supabase, vaultId, rows));
    setSelectedFileId((prev) => prev ?? rows[0]?.id ?? null);
    setLoading(false);
  }, [supabase, vaultId, router]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const meta = user.user_metadata as {
        full_name?: string;
        name?: string;
      };
      const name = meta.full_name ?? meta.name;
      if (name?.trim()) {
        const parts = name.trim().split(/\s+/);
        setSealerInitials(
          parts.length >= 2
            ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
            : name.slice(0, 2).toUpperCase()
        );
        return;
      }
      if (user.email) {
        setSealerInitials(user.email.slice(0, 2).toUpperCase());
      }
    })();
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setTextPreview(null);
    setPreviewError(null);

    if (!selectedFile) return;

    const run = async () => {
      setPreviewLoading(true);
      try {
        const blob = await downloadDecryptedFileBlob(supabase, {
          vaultId,
          storagePath: selectedFile.storage_path,
          encrypted: selectedFile.encrypted,
          mimeType: selectedFile.mime_type,
        });
        const format = resolveFileFormat(
          selectedFileName,
          selectedFile.mime_type
        );
        const mode = format?.previewMode ?? "text";
        if (cancelled) return;

        if (mode === "pdf") {
          const url = URL.createObjectURL(blob);
          previewUrlRef.current = url;
          setPreviewMode("pdf");
          setPreviewUrl(url);
        } else {
          const text = await extractTextFromFile(blob, selectedFileName);
          setPreviewMode("text");
          setTextPreview(
            text.length > PREVIEW_CHAR_LIMIT
              ? `${text.slice(0, PREVIEW_CHAR_LIMIT)}\n\n… [truncated for preview]`
              : text
          );
        }
      } catch (e) {
        if (!cancelled) {
          setPreviewError(
            e instanceof Error ? e.message : "Failed to decrypt file"
          );
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [selectedFile, selectedFileName, supabase, vaultId]);

  const handleRunExtraction = async () => {
    if (!selectedFile || !canExtract) return;
    setExtracting(true);
    setError(null);

    try {
      const blob = await downloadDecryptedFileBlob(supabase, {
        vaultId,
        storagePath: selectedFile.storage_path,
        encrypted: selectedFile.encrypted,
        mimeType: selectedFile.mime_type,
      });
      const text = await extractTextFromFile(blob, selectedFileName);
      if (!text.trim()) {
        throw new Error(`No text extracted from ${selectedFileName}.`);
      }

      const res = await fetch("/api/gemini-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:
            text.length > 200_000
              ? `${text.slice(0, 200_000)}\n\n[Document truncated for extraction]`
              : text,
          lensId: activeLensId,
          context:
            activeLensId === "custom"
              ? customPrompt
              : getLensPrompt(activeLensId, customPrompt),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Extraction failed");
      }

      const now = Date.now();
      const next: TriageSuggestion[] = (data.suggestions ?? []).map(
        (
          s: {
            eventType: string;
            qualifier: string;
            exactQuote: string;
            category: string;
            explanation: string;
            parsedDate?: string | null;
          },
          index: number
        ) => {
          const composedTitle = composeLabel(s.eventType, s.qualifier);
          const parsedDate =
            inferParsedDate(
              s.category,
              composedTitle,
              s.exactQuote,
              s.parsedDate
            ) ?? "";
          return {
            id: `tri-${selectedFile.id}-${now}-${index}`,
            fileId: selectedFile.id,
            recordId: selectedFile.record_id,
            vaultId,
            eventType: s.eventType,
            qualifier: s.qualifier,
            title: composedTitle,
            body: s.exactQuote,
            category: s.category,
            explanation: s.explanation,
            parsedDate,
            lensId: activeLensId,
          };
        }
      );

      setSuggestions(next);
      setActiveSuggestionId(next[0]?.id ?? null);
      setInspectorOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const handleSealBatch = async () => {
    if (!suggestions.length) {
      throw new Error("No objects to seal.");
    }
    await sealTemporalBatch(supabase, suggestions);
  };

  const handleSealSuccess = () => {
    setSuggestions([]);
    setActiveSuggestionId(null);
    setInspectorOpen(false);
    setError(null);
    router.push(`/vault/${vaultId}`);
  };

  return (
    <div className="min-h-screen bg-vellum">
      <header className="border-b border-bone px-8 py-4 flex items-center justify-between">
        <div>
          <Link
            href={`/vault/${vaultId}`}
            className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian"
          >
            ← Record Home
          </Link>
          <h1 className="font-head text-2xl text-obsidian mt-2">
            Temporal Extraction Engine
          </h1>
        </div>
        <span
          className="w-2 h-2 rounded-full bg-emerald pulse-emerald"
          title="Vault unlocked"
        />
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10 space-y-6">
        {error && (
          <p className="font-data text-sm text-cinnabar border border-cinnabar/30 bg-cinnabar/5 px-4 py-3">
            {error}
          </p>
        )}

        {loading ? (
          <p className="font-data text-sm text-obsidian/40">Loading files…</p>
        ) : files.length === 0 ? (
          <div className="space-y-3">
            <p className="font-data text-sm text-obsidian/50">
              No encrypted files in this vault yet.
            </p>
            <Link
              href={`/vault/${vaultId}/ingest`}
              className="font-data text-[10px] uppercase tracking-ultra border border-bone px-4 py-2 inline-block"
            >
              Open Ingestion →
            </Link>
          </div>
        ) : (
          <>
            <div>
              <label className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50">
                Source file
              </label>
              <select
                value={selectedFileId ?? ""}
                onChange={(e) => setSelectedFileId(e.target.value)}
                className="mt-2 w-full border border-bone bg-vellum px-3 py-2 font-data text-sm"
              >
                {files.map((f) => {
                  const name = fileNames[f.id] ?? f.id.slice(0, 8);
                  const fmt = resolveFileFormat(name, f.mime_type);
                  return (
                    <option key={f.id} value={f.id}>
                      {name}
                      {fmt ? ` · ${fmt.label}` : " · unsupported"}
                    </option>
                  );
                })}
              </select>
              {selectedFormat && (
                <p className="mt-2 font-data text-[10px] uppercase tracking-wider text-obsidian/40">
                  Format: {selectedFormat.label} · preview:{" "}
                  {selectedFormat.previewMode}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleRunExtraction()}
              disabled={extracting || !selectedFile || !canExtract}
              className="font-data text-[10px] uppercase tracking-ultra bg-oxford text-vellum px-6 py-3 disabled:opacity-40"
            >
              {extracting ? "Running Gemini…" : "Run extraction"}
            </button>
            {!canExtract && selectedFile && (
              <p className="font-data text-xs text-obsidian/50">
                This file type cannot be extracted. Upload a supported format
                from Ingestion.
              </p>
            )}

            {suggestions.length > 0 && (
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                className="font-data text-[10px] uppercase tracking-ultra border border-bone px-4 py-2 ml-3"
              >
                Open triage ({suggestions.length})
              </button>
            )}
          </>
        )}
      </main>

      <TriageInspectorOverlay
        isOpen={inspectorOpen}
        pdfUrl={previewUrl}
        pdfLoading={previewLoading}
        pdfError={previewError}
        previewMode={previewMode}
        textPreview={textPreview}
        fileName={selectedFileName}
        suggestions={suggestions}
        activeSuggestionId={activeSuggestionId}
        onSelectSuggestion={setActiveSuggestionId}
        onUpdateSuggestion={(id, patch) =>
          setSuggestions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
          )
        }
        onRemoveSuggestion={(id) =>
          setSuggestions((prev) => prev.filter((s) => s.id !== id))
        }
        onSealBatch={handleSealBatch}
        onSealSuccess={handleSealSuccess}
        sealerInitials={sealerInitials}
        onClose={() => setInspectorOpen(false)}
        activeLensId={activeLensId}
        onLensChange={setActiveLensId}
        customPrompt={customPrompt}
        onCustomPromptChange={setCustomPrompt}
      />

      <style
        dangerouslySetInnerHTML={{
          __html:
            ".pulse-emerald { animation: pulse-emerald 2s ease-in-out infinite; } @keyframes pulse-emerald { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); } 50% { box-shadow: 0 0 0 8px rgba(16,185,129,0); } }",
        }}
      />
    </div>
  );
}
