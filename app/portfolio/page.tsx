"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InspectorOverlay from "@/components/InspectorOverlay";
import NautilusGrid from "@/components/NautilusGrid";
import PortfolioPulsePanel from "@/components/PortfolioPulsePanel";
import PortfolioTimeline from "@/components/PortfolioTimeline";
import { downloadDecryptedFileBlob } from "@/lib/files/download-decrypted-file";
import {
  fetchPortfolioDateObjects,
  fetchPortfolioObjects,
  sortPortfolioChronologically,
  type PortfolioTemporalObject,
} from "@/lib/temporal/portfolio-fetch";
import { createClient } from "@/utils/supabase/client";

type DocumentInspectorState = {
  recordId: string;
  fileId: string | null;
  vaultId: string;
  label: string;
  vaultName: string;
};

export default function PortfolioPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [graphObjects, setGraphObjects] = useState<PortfolioTemporalObject[]>([]);
  const [timelineObjects, setTimelineObjects] = useState<PortfolioTemporalObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<PortfolioTemporalObject | null>(
    null
  );
  const [documentInspector, setDocumentInspector] =
    useState<DocumentInspectorState | null>(null);
  const [docPdfUrl, setDocPdfUrl] = useState<string | null>(null);
  const [docPdfLoading, setDocPdfLoading] = useState(false);
  const docPdfUrlRef = useRef<string | null>(null);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    try {
      const [allObjects, dateObjects] = await Promise.all([
        fetchPortfolioObjects(supabase),
        fetchPortfolioDateObjects(supabase),
      ]);
      const sortedTimeline = sortPortfolioChronologically(dateObjects);
      setGraphObjects(allObjects);
      setTimelineObjects(sortedTimeline);
      setActiveNodeId(
        sortedTimeline.find((o) => !o.isLocked)?.id ??
          allObjects.find((o) => !o.isLocked)?.id ??
          sortedTimeline[0]?.id ??
          null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    if (docPdfUrlRef.current) {
      URL.revokeObjectURL(docPdfUrlRef.current);
      docPdfUrlRef.current = null;
    }
    setDocPdfUrl(null);

    if (!documentInspector?.fileId) return;

    let cancelled = false;
    setDocPdfLoading(true);

    void (async () => {
      try {
        const { data: fileRow, error: fileError } = await supabase
          .from("files")
          .select("storage_path, mime_type, encrypted")
          .eq("id", documentInspector.fileId!)
          .single();

        if (fileError || !fileRow) {
          throw new Error(fileError?.message ?? "File not found");
        }

        const blob = await downloadDecryptedFileBlob(supabase, {
          vaultId: documentInspector.vaultId,
          storagePath: fileRow.storage_path,
          encrypted: fileRow.encrypted,
          mimeType: fileRow.mime_type,
        });

        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        docPdfUrlRef.current = url;
        setDocPdfUrl(url);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load document");
        }
      } finally {
        if (!cancelled) setDocPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentInspector, supabase]);

  useEffect(() => {
    return () => {
      if (docPdfUrlRef.current) URL.revokeObjectURL(docPdfUrlRef.current);
    };
  }, []);

  const openDocumentInspector = useCallback(
    (payload: DocumentInspectorState) => {
      setSelectedObject(null);
      setDocumentInspector(payload);
      setActiveNodeId(`doc:${payload.fileId ?? payload.recordId}`);
    },
    []
  );

  const handleDocumentSelect = useCallback(
    (payload: {
      recordId: string;
      fileId: string | null;
      vaultId: string;
      label: string;
      vaultName: string;
    }) => {
      openDocumentInspector(payload);
    },
    [openDocumentInspector]
  );

  const handleObjectSelect = useCallback((obj: PortfolioTemporalObject) => {
    setDocumentInspector(null);
    setSelectedObject(obj);
    setActiveNodeId(obj.id);
  }, []);

  const handleTimelineSelect = useCallback((id: string) => {
    setActiveNodeId(id);
    const obj = timelineObjects.find((o) => o.id === id);
    if (obj) {
      setDocumentInspector(null);
      setSelectedObject(obj);
    }
  }, [timelineObjects]);

  const handleViewSource = useCallback(
    (obj: PortfolioTemporalObject) => {
      openDocumentInspector({
        recordId: obj.recordId,
        fileId: obj.fileId,
        vaultId: obj.vaultId,
        label: obj.fileLabel ?? obj.recordTitle ?? "Source document",
        vaultName: obj.vaultName,
      });
    },
    [openDocumentInspector]
  );

  const closeDocumentInspector = () => {
    setDocumentInspector(null);
    if (docPdfUrlRef.current) {
      URL.revokeObjectURL(docPdfUrlRef.current);
      docPdfUrlRef.current = null;
    }
    setDocPdfUrl(null);
  };

  const inspectorOpen = Boolean(documentInspector);

  return (
    <div className="min-h-screen bg-vellum text-obsidian overflow-hidden">
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-8 py-4 border-b border-bone/40 bg-vellum/90 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <span className="font-head text-lg tracking-wide text-obsidian">
            Fractals · Portfolio Query
          </span>
          <Link
            href="/switchboard"
            className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian"
          >
            ← Switchboard
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadPortfolio}
            className="font-data text-[10px] uppercase tracking-ultra text-emerald border border-emerald/30 px-3 py-1.5 hover:bg-emerald/5"
          >
            Refresh
          </button>
        </div>
      </header>

      {loading && (
        <p className="fixed top-24 left-96 font-data text-sm text-obsidian/40 z-30">
          Loading portfolio…
        </p>
      )}

      {error && (
        <p className="fixed top-24 left-96 font-data text-sm text-cinnabar z-30 max-w-md">
          {error}
        </p>
      )}

      {!loading && (
        <>
          <PortfolioTimeline
            objects={timelineObjects}
            activeId={activeNodeId?.startsWith("doc:") ? null : activeNodeId}
            onSelect={handleTimelineSelect}
          />

          <NautilusGrid
            objects={graphObjects}
            activeNodeId={activeNodeId}
            onDocumentSelect={handleDocumentSelect}
            onObjectSelect={handleObjectSelect}
            insetLeftClass="left-80"
            insetRightClass={selectedObject ? "right-96" : "right-0"}
          />

          <PortfolioPulsePanel
            object={selectedObject}
            onClose={() => setSelectedObject(null)}
            onViewSource={handleViewSource}
          />

          <InspectorOverlay
            isOpen={inspectorOpen}
            pulseCoords={null}
            onClose={closeDocumentInspector}
            readOnly
            recordName={documentInspector?.label}
            recordId={documentInspector?.recordId}
            pdfUrl={docPdfUrl}
            pdfLoading={docPdfLoading}
            insetLeftClass="left-80"
            pulseData={{
              id: documentInspector?.recordId ?? "",
              date: "",
              sourceDoc: documentInspector?.label ?? "",
              clauseRaw: "",
              clauseContextFull: "",
            }}
          />
        </>
      )}
    </div>
  );
}
