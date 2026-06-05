"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import NautilusGrid from "@/components/NautilusGrid";
import RecordLedger from "@/components/RecordLedger";
import QueryInterface from "@/components/QueryInterface";
import InspectorOverlay from "@/components/InspectorOverlay";
import EncryptionKeyModal from "@/components/EncryptionKeyModal";
import DocIdentifierQueue, {
  type DocProposal,
} from "@/components/DocIdentifierQueue";
import FullScanQueue, { type FullScanRow } from "@/components/FullScanQueue";
import { useActiveVault } from "@/lib/context/active-vault";
import { useFocus } from "@/lib/context/focus";
import { useOverlayStack } from "@/lib/context/overlay-stack";
import { fetchVaultTemporalObjects } from "@/lib/temporal/record-fetch";
import { runRecordQuery, type QueryRunState } from "@/lib/temporal/record-query";
import { sealPulse } from "@/lib/temporal/seal-pulse";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import { downloadDecryptedFileBlob } from "@/lib/files/download-decrypted-file";
import {
  getVaultSessionKey,
  setVaultSessionKey,
  clearVaultSessionKey,
} from "@/lib/vault-session";
import { createClient } from "@/utils/supabase/client";
import type { VaultSummary } from "@/lib/types";

export default function RecordHomePage() {
  const params = useParams();
  const vaultId = params.vaultId as string;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const {
    setActiveVault,
    isUnlocked,
    unlockVault,
    handshakePhase,
    startHandshake,
    completeHandshake,
    blockHandshake,
  } = useActiveVault();
  const { focusedId, setFocusedId, setOrderedIds, registerKeyboard } =
    useFocus();
  const { isInspectorOpen, closeOverlay } = useOverlayStack();

  const [vaultName, setVaultName] = useState("Record");
  const [objects, setObjects] = useState<PortfolioTemporalObject[]>([]);
  const [displayObjects, setDisplayObjects] = useState<PortfolioTemporalObject[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [pendingVault, setPendingVault] = useState<VaultSummary | null>(null);
  const [queryState, setQueryState] = useState<QueryRunState>({ status: "idle" });
  const [pulseCoords, setPulseCoords] = useState<{ x: number; y: number } | null>(
    null
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [docProposals, setDocProposals] = useState<DocProposal[]>([]);
  const [fullScanRows, setFullScanRows] = useState<FullScanRow[]>([]);
  const pdfRef = useRef<string | null>(null);

  const selected = displayObjects.find((o) => o.id === focusedId) ?? null;

  const loadVault = useCallback(async () => {
    const { data: vault } = await supabase
      .from("vaults")
      .select("name, encryption_test")
      .eq("id", vaultId)
      .single();
    if (vault) {
      setVaultName(vault.name);
      setActiveVault({ id: vaultId, name: vault.name });
      if (!isUnlocked(vaultId)) {
        setPendingVault({
          id: vaultId,
          name: vault.name,
          encryption_test: vault.encryption_test,
          created_by: null,
          role: "USER",
        });
        blockHandshake();
        setLoading(false);
        return;
      }
    }
    startHandshake();
    const objs = await fetchVaultTemporalObjects(supabase, vaultId, vault?.name ?? "Record");
    setObjects(objs);
    setDisplayObjects(objs);
    setOrderedIds(objs.map((o) => o.id));
    setFocusedId(objs.find((o) => o.isSealed)?.id ?? objs[0]?.id ?? null);
    setLoading(false);
    completeHandshake();
  }, [
    supabase,
    vaultId,
    setActiveVault,
    isUnlocked,
    startHandshake,
    completeHandshake,
    blockHandshake,
    setOrderedIds,
    setFocusedId,
  ]);

  useEffect(() => {
    loadVault();
    registerKeyboard(true);
    return () => registerKeyboard(false);
  }, [loadVault, registerKeyboard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Enter" && focusedId && !inspectorOpen) {
        setInspectorOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, inspectorOpen]);

  useEffect(() => {
    if (!selected?.fileId || !inspectorOpen) {
      if (pdfRef.current) {
        URL.revokeObjectURL(pdfRef.current);
        pdfRef.current = null;
        setPdfUrl(null);
      }
      return;
    }
    setPdfLoading(true);
    (async () => {
      const { data: fileRow } = await supabase
        .from("files")
        .select("storage_path, encrypted, mime_type")
        .eq("id", selected.fileId!)
        .single();
      if (!fileRow?.storage_path) {
        setPdfUrl(null);
        return;
      }
      return downloadDecryptedFileBlob(supabase, {
        vaultId,
        storagePath: fileRow.storage_path,
        encrypted: fileRow.encrypted,
        mimeType: fileRow.mime_type,
      });
    })()
      .then((blob) => {
        if (!blob) return;
        if (pdfRef.current) URL.revokeObjectURL(pdfRef.current);
        const url = URL.createObjectURL(blob);
        pdfRef.current = url;
        setPdfUrl(url);
      })
      .catch(() => setPdfUrl(null))
      .finally(() => setPdfLoading(false));
  }, [selected, inspectorOpen, supabase, vaultId]);

  const handleQuery = async (query: string) => {
    setQueryState({ status: "running" });
    setQueryState({ status: "identifying" });
    const result = await runRecordQuery(supabase, vaultId, vaultName, query);
    setQueryState(result);
    if (result.status === "completed") {
      const merged = [
        ...objects.filter((o) => o.isSealed),
        ...result.candidates.filter((c) => !c.isSealed),
      ];
      setDisplayObjects(merged);
      setOrderedIds(merged.map((o) => o.id));
      if (result.candidates[0]) setFocusedId(result.candidates[0].id);
    }
  };

  const handleSeal = async () => {
    if (!selected || selected.isLocked) return;
    await sealPulse(supabase, {
      pulseId: selected.id,
      vaultId,
      recordId: selected.recordId,
      title: selected.title ?? "Untitled",
      body: selected.body ?? "",
      explanation: selected.explanation ?? undefined,
      category: selected.category ?? undefined,
      parsedDate: selected.parsedDate,
    });
    await loadVault();
    setInspectorOpen(false);
  };

  if (handshakePhase === "blocked" && pendingVault) {
    return (
      <EncryptionKeyModal
        vault={pendingVault}
        currentKey={getVaultSessionKey(vaultId)}
        onSave={(key) => {
          if (key) {
            unlockVault(vaultId, key);
            setPendingVault(null);
            loadVault();
          } else {
            clearVaultSessionKey(vaultId);
            router.push("/switchboard");
          }
        }}
        onClose={() => router.push("/switchboard")}
      />
    );
  }

  if (loading) {
    return (
      <p className="font-data text-sm text-obsidian/40 text-center py-20">
        Entering record…
      </p>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="px-6 py-4 border-b border-bone/30 flex justify-between items-center">
        <div>
          <h1 className="font-head text-xl text-obsidian">{vaultName}</h1>
          <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40">
            Record Home · {displayObjects.filter((o) => o.isSealed).length} sealed
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/vault/${vaultId}/ingest`)}
          className="font-data text-[10px] uppercase tracking-ultra border border-bone px-3 py-1.5 hover:bg-bone/10"
        >
          Ingestion
        </button>
      </div>

      <div className="flex min-h-[520px]">
        <div className="flex-1 relative min-h-[480px]">
          <NautilusGrid
            objects={displayObjects}
            activePulseId={focusedId}
            onPulseClick={(id, coords) => {
              setFocusedId(id);
              setPulseCoords(coords);
            }}
            isInspectorOpen={inspectorOpen || isInspectorOpen}
            insetLeftClass="left-16"
            insetRightClass="right-[min(380px,38vw)]"
          />
        </div>
        <div className="w-[min(380px,38vw)] border-l border-bone bg-vellum/95 p-4 overflow-y-auto">
          <h2 className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 mb-3">
            Ledger
          </h2>
          <RecordLedger
            objects={displayObjects}
            focusedId={focusedId}
            onSelect={setFocusedId}
            onOpen={(id) => {
              setFocusedId(id);
              setInspectorOpen(true);
            }}
          />
          <DocIdentifierQueue
            proposals={docProposals}
            onApprove={() => {}}
            onDismiss={() => {}}
            onEdit={() => {}}
          />
          <FullScanQueue rows={fullScanRows} onOpen={() => setInspectorOpen(true)} />
        </div>
      </div>

      <QueryInterface
        onSubmit={handleQuery}
        isProcessing={
          queryState.status === "running" || queryState.status === "identifying"
        }
      />

      {selected && (
        <InspectorOverlay
          isOpen={inspectorOpen}
          pulseCoords={pulseCoords}
          onClose={() => {
            setInspectorOpen(false);
            closeOverlay();
          }}
          onSeal={handleSeal}
          pulseData={{
            id: selected.id,
            date: selected.parsedDate ?? "",
            sourceDoc: selected.fileLabel ?? vaultName,
            clauseRaw: selected.title ?? "",
            clauseContextFull: selected.body ?? "",
          }}
          recordName={vaultName}
          recordId={selected.recordId}
          isAlreadySealed={selected.isSealed}
          hasEvidence={Boolean(selected.fileId)}
          pdfUrl={pdfUrl}
          pdfLoading={pdfLoading}
          insetLeftClass="left-16"
        />
      )}
    </div>
  );
}
