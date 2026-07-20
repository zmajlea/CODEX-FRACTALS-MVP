"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResetClientDataCounts } from "@/lib/treasury/reset-client-data";

type Props = {
  clientUserId: string;
  clientName: string;
  /** When true, hide the control (server still refuses). */
  protectedRecord?: boolean;
  onResetComplete?: () => void;
};

function formatCountLine(counts: ResetClientDataCounts, clientName: string): string {
  const parts = [
    `**${counts.transactions.toLocaleString()} transactions**`,
    `**${counts.accounts.toLocaleString()} account${counts.accounts === 1 ? "" : "s"}**`,
    `**${counts.rules.toLocaleString()} rule${counts.rules === 1 ? "" : "s"}**`,
    `**${counts.studies.toLocaleString()} stud${counts.studies === 1 ? "y" : "ies"}**`,
  ];
  if (counts.sent_recommendations > 0) {
    parts.push(
      `**${counts.sent_recommendations.toLocaleString()} recommendations and questions you have already sent to this client**`
    );
  } else if (counts.recommendations > 0) {
    parts.push(
      `**${counts.recommendations.toLocaleString()} recommendation${
        counts.recommendations === 1 ? "" : "s"
      } and question${counts.recommendations === 1 ? "" : "s"}**`
    );
  }
  return `This will permanently delete ${parts.join(", ")}. ${clientName} stays in your portfolio, empty. This cannot be undone.`;
}

/**
 * Spec 49B — Profile tab bottom. Invented copy (not in Ana's files).
 */
export function TreasuryResetClientDataBlock({
  clientUserId,
  clientName,
  protectedRecord = false,
  onResetComplete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<ResetClientDataCounts | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/reset`
      );
      const data = (await res.json()) as {
        error?: string;
        counts?: ResetClientDataCounts;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not load reset counts");
        setCounts(null);
        return;
      }
      setCounts(data.counts ?? null);
    } catch {
      setError("Could not load reset counts");
    } finally {
      setLoadingCounts(false);
    }
  }, [clientUserId]);

  useEffect(() => {
    if (open) void loadCounts();
  }, [open, loadCounts]);

  if (protectedRecord) return null;

  const nameOk = typed.trim() === clientName.trim();

  async function runReset() {
    if (!nameOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/reset`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm_name: typed.trim() }),
        }
      );
      const data = (await res.json()) as {
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        setError(
          [data.error, data.hint].filter(Boolean).join(" ") || "Reset failed"
        );
        return;
      }
      setOpen(false);
      setTyped("");
      setCounts(null);
      onResetComplete?.();
    } catch {
      setError("Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="panel p-4"
      style={{ borderColor: "var(--cinnabar, #E67E50)", borderWidth: 1 }}
    >
      <div className="panel-h">
        <span className="ph-t">Reset this record</span>
        <span className="ph-side">destructive</span>
      </div>
      <p className="text-sm text-codex-muted mb-3">
        Delete all imported data, rules, studies and sent items for this client.
        The client stays in your portfolio, empty.
      </p>

      {!open ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen(true)}
        >
          Reset client data
        </button>
      ) : (
        <div className="space-y-3">
          {loadingCounts ? (
            <p className="treasury-meta text-sm">Counting…</p>
          ) : counts ? (
            <p className="text-sm text-codex-ink">
              {formatCountLine(counts, clientName)
                .split(/\*\*(.*?)\*\*/g)
                .map((part, i) =>
                  i % 2 === 1 ? (
                    <strong key={i}>{part}</strong>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
            </p>
          ) : null}

          <label className="block text-sm">
            <span className="treasury-meta-fine">
              Type <strong>{clientName}</strong> to confirm
            </span>
            <input
              type="text"
              className="mt-1 w-full border border-sealed-bone bg-digital-vellum px-2 py-1.5 text-sm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>

          {error ? (
            <p className="text-sm text-cinnabar" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!nameOk || busy || loadingCounts}
              onClick={() => void runReset()}
            >
              {busy ? "Resetting…" : "Reset client data"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
