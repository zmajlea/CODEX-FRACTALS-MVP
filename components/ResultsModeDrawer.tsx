"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortfolioTimeline from "@/components/PortfolioTimeline";
import InspectorOverlay from "@/components/InspectorOverlay";
import { useOverlayStack } from "@/lib/context/overlay-stack";
import {
  fetchPortfolioDateObjects,
  sortPortfolioChronologically,
  type PortfolioTemporalObject,
} from "@/lib/temporal/portfolio-fetch";
import { createClient } from "@/utils/supabase/client";

type ResultsModeDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  vaultsLoading?: boolean;
  eligibleVaultIds: Set<string>;
  scopeVaultIds: Set<string>;
  onToggleScope: (vaultId: string) => void;
  vaultNames: Record<string, string>;
};

export default function ResultsModeDrawer({
  isOpen,
  onClose,
  vaultsLoading = false,
  eligibleVaultIds,
  scopeVaultIds,
  onToggleScope,
  vaultNames,
}: ResultsModeDrawerProps) {
  const supabase = useMemo(() => createClient(), []);
  const { openInspector, closeOverlay, isInspectorOpen } = useOverlayStack();
  const [objects, setObjects] = useState<PortfolioTemporalObject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PortfolioTemporalObject | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const all = await fetchPortfolioDateObjects(supabase);
      const scoped = all.filter(
        (o) =>
          eligibleVaultIds.has(o.vaultId) &&
          (scopeVaultIds.size === 0 || scopeVaultIds.has(o.vaultId))
      );
      const sorted = sortPortfolioChronologically(scoped);
      setObjects(sorted);
      setActiveId(sorted[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [supabase, isOpen, eligibleVaultIds, scopeVaultIds]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRowClick = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (!obj || obj.isLocked) return;
    setActiveId(id);
    setSelected(obj);
    openInspector({
      vaultId: obj.vaultId,
      recordId: obj.recordId,
      pulseId: obj.id,
      fileId: obj.fileId,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <aside className="fixed top-16 right-0 bottom-0 w-[min(420px,40vw)] border-l border-bone bg-vellum/95 backdrop-blur-sm z-30 flex flex-col shadow-xl">
        <div className="px-4 py-3 border-b border-bone flex justify-between items-center">
          <div>
            <h2 className="font-head text-sm text-obsidian">Results Ledger</h2>
            <p className="font-data text-[9px] uppercase tracking-ultra text-obsidian/40">
              Cross-portfolio recall
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-data text-[10px] uppercase text-obsidian/50"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-2 border-b border-bone/50 max-h-24 overflow-y-auto">
          <p className="font-data text-[9px] uppercase tracking-ultra text-obsidian/40 mb-2">
            Scope
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from(eligibleVaultIds).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onToggleScope(id)}
                className={
                  "font-data text-[9px] uppercase px-2 py-1 border " +
                  (scopeVaultIds.has(id) || scopeVaultIds.size === 0
                    ? "border-amber bg-amber/20"
                    : "border-bone text-obsidian/40")
                }
              >
                {vaultNames[id]?.slice(0, 12) ?? id.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>

        {loading || vaultsLoading ? (
          <p className="p-6 font-data text-xs text-obsidian/40 text-center">
            Loading…
          </p>
        ) : (
          <PortfolioTimeline
            objects={objects}
            activeId={activeId}
            onSelect={handleRowClick}
            embedded
            showNowMarker
          />
        )}
      </aside>

      {selected && (
        <InspectorOverlay
          isOpen={isInspectorOpen}
          pulseCoords={null}
          onClose={closeOverlay}
          pulseData={{
            id: selected.id,
            date: selected.parsedDate ?? "",
            sourceDoc: selected.fileLabel ?? selected.vaultName,
            clauseRaw: (selected.composedLabel || selected.title) ?? "",
            clauseContextFull: selected.body ?? "",
            eventType: selected.eventType ?? "",
            qualifier: selected.qualifier ?? "",
          }}
          recordName={selected.vaultName}
          recordId={selected.recordId}
          isAlreadySealed={selected.isSealed}
          readOnly={selected.isSealed}
          insetLeftClass="left-16"
        />
      )}
    </>
  );
}
