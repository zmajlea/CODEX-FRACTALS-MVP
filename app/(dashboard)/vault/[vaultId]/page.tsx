"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PortfolioTimeline from "@/components/PortfolioTimeline";
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
import {
  fetchVaultTemporalObjectsProgressive,
  hydrateTemporalObjectDetails,
} from "@/lib/temporal/record-fetch";
import { applyVaultQueryView } from "@/lib/temporal/record-query";
import { sealPulse } from "@/lib/temporal/seal-pulse";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import { composeLabel } from "@/lib/temporal/event-types";
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
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);
  const [inspectorPulse, setInspectorPulse] =
    useState<PortfolioTemporalObject | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [pendingVault, setPendingVault] = useState<VaultSummary | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [labelDraft, setLabelDraft] = useState<{
    eventType: string;
    qualifier: string;
  }>({ eventType: "", qualifier: "" });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [docProposals, setDocProposals] = useState<DocProposal[]>([]);
  const [fullScanRows, setFullScanRows] = useState<FullScanRow[]>([]);
  const pdfRef = useRef<string | null>(null);

  const displayObjects = useMemo(
    () => applyVaultQueryView(objects, filterQuery),
    [objects, filterQuery]
  );

  const selected =
    displayObjects.find((o) => o.id === focusedId) ??
    objects.find((o) => o.id === focusedId) ??
    null;

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
    setObjects([]);
    setLoadProgress(null);

    let firstBatch = true;
    let accumulatedIds: string[] = [];
    const objs = await fetchVaultTemporalObjectsProgressive(
      supabase,
      vaultId,
      vault?.name ?? "Record",
      (batch, progress) => {
        setObjects((prev) => [...prev, ...batch]);
        accumulatedIds = [...accumulatedIds, ...batch.map((o) => o.id)];
        setLoadProgress({ loaded: progress.loaded, total: progress.total });
        if (firstBatch) {
          firstBatch = false;
          setOrderedIds(accumulatedIds);
          setFocusedId(
            batch.find((o) => o.isSealed)?.id ?? batch[0]?.id ?? null
          );
          setLoading(false);
          completeHandshake();
        } else {
          setOrderedIds(accumulatedIds);
        }
      }
    );

    if (objs.length === 0) {
      setLoading(false);
      completeHandshake();
    }
    setOrderedIds(objs.map((o) => o.id));
    setLoadProgress(null);
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
    setOrderedIds(displayObjects.map((o) => o.id));
  }, [displayObjects, setOrderedIds]);

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
    if (!selected) return;
    setLabelDraft({
      eventType: selected.eventType ?? "",
      qualifier: selected.qualifier ?? "",
    });
  }, [selected?.id, selected?.eventType, selected?.qualifier]);

  useEffect(() => {
    if (!inspectorOpen || !selected) {
      setInspectorPulse(null);
      return;
    }
    if (selected.detailsLoaded) {
      setInspectorPulse(selected);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    void hydrateTemporalObjectDetails(selected).then((hydrated) => {
      if (cancelled) return;
      setInspectorPulse(hydrated);
      setDetailsLoading(false);
      const merge = (list: PortfolioTemporalObject[]) =>
        list.map((o) => (o.id === hydrated.id ? hydrated : o));
      setObjects(merge);
    });
    return () => {
      cancelled = true;
    };
  }, [inspectorOpen, selected?.id, selected?.detailsLoaded]);

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

  const patchSelectedLabel = (patch: { eventType: string; qualifier: string }) => {
    setLabelDraft(patch);
    if (!selected) return;
    const composedLabel = composeLabel(patch.eventType, patch.qualifier);
    const merge = (list: PortfolioTemporalObject[]) =>
      list.map((o) =>
        o.id === selected.id
          ? {
              ...o,
              eventType: patch.eventType,
              qualifier: patch.qualifier,
              composedLabel,
              title: composedLabel,
            }
          : o
      );
    setObjects(merge);
  };

  const handleSeal = async () => {
    if (!selected || selected.isLocked) return;
    const pulse = selected.detailsLoaded
      ? selected
      : await hydrateTemporalObjectDetails(selected);
    await sealPulse(supabase, {
      pulseId: pulse.id,
      vaultId,
      recordId: pulse.recordId,
      eventType: labelDraft.eventType,
      qualifier: labelDraft.qualifier,
      body: pulse.body ?? "",
      explanation: pulse.explanation ?? undefined,
      category: pulse.category ?? undefined,
      parsedDate: pulse.parsedDate,
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
            Record Home · {objects.filter((o) => o.isSealed).length} sealed
            {loadProgress
              ? ` · decrypting ${loadProgress.loaded}/${loadProgress.total}`
              : ""}
            {filterQuery.trim()
              ? ` · ${displayObjects.length} filtered`
              : ""}
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
        <div className="flex-1 relative min-h-[480px] overflow-hidden">
          <PortfolioTimeline
            objects={displayObjects}
            activeId={focusedId}
            onSelect={setFocusedId}
            embedded
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
        value={filterQuery}
        onChange={setFilterQuery}
        resultCount={filterQuery.trim() ? displayObjects.length : undefined}
      />

      {selected && (
        <InspectorOverlay
          isOpen={inspectorOpen}
          pulseCoords={null}
          onClose={() => {
            setInspectorOpen(false);
            closeOverlay();
          }}
          onSeal={handleSeal}
          onLabelChange={patchSelectedLabel}
          pulseData={{
            id: selected.id,
            date: selected.parsedDate ?? "",
            sourceDoc: selected.fileLabel ?? vaultName,
            clauseRaw: selected.composedLabel || selected.title || "",
            clauseContextFull: detailsLoading
              ? "Decrypting evidence…"
              : (inspectorPulse?.body ?? selected.body ?? ""),
            eventType: labelDraft.eventType,
            qualifier: labelDraft.qualifier,
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
