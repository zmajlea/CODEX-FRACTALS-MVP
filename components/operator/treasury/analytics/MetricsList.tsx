"use client";

import { useCallback, useEffect, useState } from "react";

type MetricRow = {
  id: string;
  name: string;
  description: string;
  source: string;
  computed_value: { value?: number } | null;
  computed_at: string | null;
};

type Props = {
  clientUserId: string;
};

/** Spec B3 Part B — metrics defined for this client (incl. global). */
export function MetricsList({ clientUserId }: Props) {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/metrics`
    );
    if (!res.ok) return;
    const json = (await res.json()) as { metrics?: MetricRow[] };
    setRows(json.metrics ?? []);
  }, [clientUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/metrics/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Delete failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length && !error) return null;

  return (
    <div
      className="panel p-3 space-y-3"
      style={{ border: "1px solid var(--line)" }}
      data-testid="metrics-list"
    >
      <p className="sec-title mb-0">Metrics</p>
      <p className="treasury-meta text-sm">
        Derived variables for this client.{" "}
        <a
          href={`/operator/treasury/clients/${clientUserId}?tab=metrics`}
          className="underline"
        >
          Open Metrics tab
        </a>
      </p>
      {error ? <p className="treasury-meta cm-err">{error}</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => {
          const value =
            row.computed_value && typeof row.computed_value.value === "number"
              ? row.computed_value.value.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })
              : "—";
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-2 border border-[var(--line)] rounded p-2"
            >
              <div>
                <p className="font-medium mb-0">
                  {row.name}{" "}
                  <span className="treasury-meta-fine text-xs">{row.source}</span>
                </p>
                <p className="treasury-meta text-sm mb-0">
                  {row.description || "—"} · {value}
                </p>
              </div>
              <button
                type="button"
                className="chip"
                disabled={busy === row.id}
                onClick={() => void remove(row.id)}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
