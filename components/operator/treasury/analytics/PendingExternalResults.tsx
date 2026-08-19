"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExternalModelStudyRow } from "@/lib/treasury/studies";

type Props = {
  clientUserId: string;
};

function isExternalPending(
  s: Record<string, unknown>
): s is ExternalModelStudyRow {
  return s.type === "external_model" && s.status === "pending";
}

/** Spec B1 Part F — pending MCP external results confirm surface. */
export function PendingExternalResults({ clientUserId }: Props) {
  const [rows, setRows] = useState<ExternalModelStudyRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/studies`
    );
    if (!res.ok) return;
    const json = (await res.json()) as { studies?: Record<string, unknown>[] };
    const pending = (json.studies ?? []).filter(isExternalPending) as ExternalModelStudyRow[];
    setRows(pending);
  }, [clientUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(studyId: string) {
    setBusy(studyId);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/studies/${studyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "confirmed" }),
        }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Confirm failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(null);
    }
  }

  async function discard(studyId: string) {
    setBusy(studyId);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/studies/${studyId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Discard failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length && !error) return null;

  return (
    <div
      className="panel p-3 space-y-3"
      style={{ border: "1px solid var(--line)" }}
      data-testid="pending-external-results"
    >
      <p className="sec-title mb-0">Pending results (MCP)</p>
      <p className="treasury-meta text-sm">
        Submitted via MCP — confirm before they enter reports.
      </p>
      {error ? <p className="treasury-meta cm-err">{error}</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => {
          const snap = row.derived_snapshot;
          const warnings = (snap?.validationReport as { warnings?: string[] })
            ?.warnings;
          const baseline = snap?.engineBaseline as {
            breach_month?: string | null;
            runway_months?: number | null;
          } | null;
          return (
            <li
              key={row.id}
              className="border border-[var(--line)] rounded p-3 space-y-2"
            >
              <p className="font-medium">{row.name}</p>
              {warnings?.length ? (
                <ul className="treasury-meta text-sm list-disc pl-4">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : (
                <p className="treasury-meta text-sm">Validation clean.</p>
              )}
              {baseline ? (
                <p className="treasury-meta-fine text-sm">
                  Engine baseline · breach {baseline.breach_month ?? "none"} ·
                  runway {baseline.runway_months ?? "—"} mo
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="chip"
                  disabled={busy === row.id}
                  onClick={() => void confirm(row.id)}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={busy === row.id}
                  onClick={() => void discard(row.id)}
                >
                  Discard
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
