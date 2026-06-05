"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import TriageInspectorOverlay from "@/components/TriageInspectorOverlay";
import { extractTextFromFile } from "@/lib/file-text-extraction";
import { downloadDecryptedFileBlob } from "@/lib/files/download-decrypted-file";
import {
  getLensPrompt,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";
import { inferParsedDate } from "@/lib/temporal/parse-date";
import {
  sealTemporalBatch,
  type TriageSuggestion,
} from "@/lib/temporal/seal-batch";
import type { VaultFileRow } from "@/lib/types";
import { getVaultSessionKey } from "@/lib/vault-session";
import { createClient } from "@/utils/supabase/client";

export default function VaultExtractPage() {
  const params = useParams<{ vaultId: string }>();
  const vaultId = params.vaultId;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [files, setFiles] = useState<VaultFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [sealerInitials, setSealerInitials] = useState("FR");

  const [activeLensId, setActiveLensId] =
    useState<IntelligenceLensId>("compliance");
  const [customPrompt, setCustomPrompt] = useState("");

  const [suggestions, setSuggestions] = useState<TriageSuggestion[]>([]);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(
    null
  );

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;

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

    setFiles((data ?? []) as VaultFileRow[]);
    setSelectedFileId((prev) => prev ?? data?.[0]?.id ?? null);
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

    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setPdfUrl(null);
    setPdfError(null);

    if (!selectedFile) return;

    const run = async () => {
      setPdfLoading(true);
      try {
        const blob = await downloadDecryptedFileBlob(supabase, {
          vaultId,
          storagePath: selectedFile.storage_path,
          encrypted: selectedFile.encrypted,
          mimeType: selectedFile.mime_type,
        });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        pdfUrlRef.current = url;
        setPdfUrl(url);
      } catch (e) {
        if (!cancelled) {
          setPdfError(e instanceof Error ? e.message : "Failed to decrypt PDF");
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, [selectedFile, supabase, vaultId]);

  const handleRunExtraction = async () => {
    if (!selectedFile) return;
    setExtracting(true);
    setError(null);

    try {
      const blob = await downloadDecryptedFileBlob(supabase, {
        vaultId,
        storagePath: selectedFile.storage_path,
        encrypted: selectedFile.encrypted,
        mimeType: selectedFile.mime_type,
      });
      const text = await extractTextFromFile(blob, "document.pdf");
      if (!text.trim()) {
        throw new Error("No text extracted from PDF.");
      }

      const res = await fetch("/api/gemini-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
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
        (s: {
          title: string;
          exactQuote: string;
          category: string;
          explanation: string;
          parsedDate?: string | null;
        }, index: number) => {
          const parsedDate =
            inferParsedDate(
              s.category,
              s.title,
              s.exactQuote,
              s.parsedDate
            ) ?? "";
          return {
            id: `tri-${selectedFile.id}-${now}-${index}`,
            fileId: selectedFile.id,
            recordId: selectedFile.record_id,
            vaultId,
            title: s.title,
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
  };

  return (
    <div className="min-h-screen bg-vellum">
      <header className="border-b border-bone px-8 py-4 flex items-center justify-between">
        <div>
          <Link
            href="/switchboard"
            className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian"
          >
            ΓåÉ Switchboard
          </Link>
          <h1 className="font-head text-2xl text-obsidian mt-2">
            Temporal Extraction Engine
          </h1>
        </div>
        <span className="w-2 h-2 rounded-full bg-emerald pulse-emerald" title="Vault unlocked" />
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10 space-y-6">
        {error && (
          <p className="font-data text-sm text-cinnabar border border-cinnabar/30 bg-cinnabar/5 px-4 py-3">
            {error}
          </p>
        )}

        {loading ? (
          <p className="font-data text-sm text-obsidian/40">Loading filesΓÇª</p>
        ) : files.length === 0 ? (
          <p className="font-data text-sm text-obsidian/50">
            No encrypted files in this vault. Upload a PDF from the Switchboard first.
          </p>
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
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id.slice(0, 8)}ΓÇª ┬╖ record {f.record_id.slice(0, 8)}ΓÇª
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void handleRunExtraction()}
              disabled={extracting || !selectedFile}
              className="font-data text-[10px] uppercase tracking-ultra bg-oxford text-vellum px-6 py-3 disabled:opacity-40"
            >
              {extracting ? "Running GeminiΓÇª" : "Run extraction"}
            </button>

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
        pdfUrl={pdfUrl}
        pdfLoading={pdfLoading}
        pdfError={pdfError}
        fileName={selectedFile?.id}
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
