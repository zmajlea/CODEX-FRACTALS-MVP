"use client";

import { useEffect, useState } from "react";
import type { CommittedFlowLine } from "@/lib/treasury/committed-flows";

type Props = {
  clientUserId: string;
  accountId: string;
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function CashModelCommittedFlowsCard({ clientUserId, accountId }: Props) {
  const [lines, setLines] = useState<CommittedFlowLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const qs = new URLSearchParams({ account_id: accountId, days: "30" });
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/committed-flows?${qs}`
        );
        const json = (await res.json()) as {
          lines?: CommittedFlowLine[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Load failed");
        if (!cancelled) setLines(json.lines ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
          setLines([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientUserId, accountId]);

  return (
    <div className="panel p-4 space-y-2" style={{ border: "1px solid var(--line)" }}>
      <p className="sec-title">Upcoming committed flows</p>
      <p className="treasury-meta">Recurring labeled or rule-covered lines · next 30 days</p>
      {loading ? <p className="treasury-meta">Loading…</p> : null}
      {error ? <p className="treasury-meta">{error}</p> : null}
      {!loading && !error && lines.length === 0 ? (
        <p className="treasury-meta">No recurring flows detected in window.</p>
      ) : null}
      {!loading && lines.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {lines.slice(0, 12).map((line) => (
            <li key={`${line.merchant}-${line.nextDate}-${line.direction}`} className="flex justify-between gap-3">
              <span>
                {line.merchant}{" "}
                <span className="treasury-meta">· {line.cadence}</span>
              </span>
              <span className="num whitespace-nowrap">
                {line.direction === "out" ? "−" : "+"}
                {fmtMoney(line.amount)} · {fmtDate(line.nextDate)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
