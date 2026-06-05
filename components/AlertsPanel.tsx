"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

type AlertRow = {
  id: string;
  pulse_id: string;
  schedule_at: string;
  status: string;
};

type AlertsPanelProps = {
  vaultId: string;
  isOpen: boolean;
  onClose: () => void;
};

export default function AlertsPanel({
  vaultId,
  isOpen,
  onClose,
}: AlertsPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("alerts")
        .select("id, pulse_id, schedule_at, status")
        .eq("vault_id", vaultId);
      setAlerts(data ?? []);
    })();
  }, [isOpen, supabase, vaultId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="flex-1 bg-obsidian/20"
        onClick={onClose}
        aria-label="Close alerts"
      />
      <aside className="w-full max-w-md bg-vellum border-l border-bone h-full pt-16">
        <div className="px-6 py-4 border-b border-bone flex justify-between">
          <h2 className="font-head text-lg">Alerts</h2>
          <button type="button" onClick={onClose} className="font-data text-[10px] uppercase">
            Close
          </button>
        </div>
        <div className="p-4 space-y-2">
          {alerts.length === 0 ? (
            <p className="font-data text-xs text-obsidian/40 text-center py-8">
              No alerts — sealed milestones only.
            </p>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className="border border-bone px-3 py-2 font-data text-xs flex justify-between"
              >
                <span>{a.schedule_at.slice(0, 10)}</span>
                <span className="uppercase text-obsidian/50">{a.status}</span>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
