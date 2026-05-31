"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NautilusGrid from "@/components/NautilusGrid";
import PortfolioTimeline from "@/components/PortfolioTimeline";
import {
  fetchPortfolioDateObjects,
  sortPortfolioChronologically,
  type PortfolioTemporalObject,
} from "@/lib/temporal/portfolio-fetch";
import { mapPortfolioToNautilus } from "@/lib/temporal/nautilus-map";
import { createClient } from "@/utils/supabase/client";

export default function PortfolioPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [objects, setObjects] = useState<PortfolioTemporalObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePulseId, setActivePulseId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [invertScroll, setInvertScroll] = useState(false);

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
      const rows = await fetchPortfolioDateObjects(supabase);
      const sorted = sortPortfolioChronologically(rows);
      setObjects(sorted);
      setActivePulseId(sorted.find((o) => !o.isLocked)?.id ?? sorted[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  const { hubs, pulses, sealedPulseIds } = useMemo(
    () => mapPortfolioToNautilus(objects),
    [objects]
  );

  const activeObject = objects.find((o) => o.id === activePulseId) ?? null;

  const handleOpenInspector = (pulseId: string) => {
    setActivePulseId(pulseId);
  };

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
            onClick={() => setShowGrid((v) => !v)}
            className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian border border-bone/30 px-3 py-1.5"
          >
            {showGrid ? "[−] Grid" : "[+] Grid"}
          </button>
          <button
            type="button"
            onClick={() => setInvertScroll((v) => !v)}
            className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 hover:text-obsidian border border-bone/30 px-3 py-1.5"
          >
            Scroll {invertScroll ? "Past" : "Future"}
          </button>
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
        <p className="fixed top-24 left-96 font-data text-sm text-cinnabar z-30">
          {error}
        </p>
      )}

      {!loading && (
        <>
          <PortfolioTimeline
            objects={objects}
            activeId={activePulseId}
            onSelect={setActivePulseId}
          />

          <NautilusGrid
            isInspectorOpen={false}
            activePulseId={activePulseId}
            onOpenInspector={(id) => handleOpenInspector(id)}
            sealedPulses={sealedPulseIds}
            pulses={pulses}
            hubs={hubs}
            showGrid={showGrid}
            invertScroll={invertScroll}
            insetLeftClass="left-80"
          />

          {activeObject && !activeObject.isLocked && (
            <div className="fixed bottom-8 right-8 z-30 w-full max-w-md border border-bone/50 bg-vellum/90 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.08)] p-6">
              <p className="font-data text-[10px] uppercase tracking-ultra text-obsidian/40 mb-2">
                Active Pulse · {activeObject.vaultName}
              </p>
              <h3 className="font-head text-xl text-obsidian mb-1">
                {activeObject.title}
              </h3>
              <p className="font-data text-sm text-emerald mb-3">
                {activeObject.parsedDate ?? "No date"}
              </p>
              {activeObject.body && (
                <p className="font-data text-xs text-obsidian/60 leading-relaxed mb-3">
                  {activeObject.body}
                </p>
              )}
              {activeObject.explanation && (
                <p className="font-data text-xs text-obsidian/45 italic border-l-2 border-bone pl-3">
                  {activeObject.explanation}
                </p>
              )}
              {activeObject.fileLabel && (
                <p className="font-data text-[10px] uppercase tracking-widest text-oxford mt-4">
                  Source · {activeObject.fileLabel}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
