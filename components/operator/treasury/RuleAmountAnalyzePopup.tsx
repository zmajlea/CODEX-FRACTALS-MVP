"use client";

import { useEffect, useMemo, useState } from "react";
import type { RulePayeeStats } from "@/lib/treasury/rule-predicate";

type Props = {
  open: boolean;
  onClose: () => void;
  clientUserId: string;
  payeeQuery: string;
  matchType: string;
  direction: "in" | "out" | "";
  amountMin: string;
  amountMax: string;
  onApplyBand: (opts: {
    amountMin: string;
    amountMax: string;
    direction: "in" | "out" | "";
  }) => void;
  onSuggestAll: () => void;
};

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Spec 63 Part C — amount distribution popup. Copy flagged for Ana. */
export function RuleAmountAnalyzePopup({
  open,
  onClose,
  clientUserId,
  payeeQuery,
  matchType,
  direction,
  amountMin,
  amountMax,
  onApplyBand,
  onSuggestAll,
}: Props) {
  const [stats, setStats] = useState<RulePayeeStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  const [localMin, setLocalMin] = useState(amountMin);
  const [localMax, setLocalMax] = useState(amountMax);
  const [localDir, setLocalDir] = useState(direction);
  const [willSuggest, setWillSuggest] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalMin(amountMin);
    setLocalMax(amountMax);
    setLocalDir(direction);
  }, [open, amountMin, amountMax, direction]);

  useEffect(() => {
    if (!open || !payeeQuery.trim()) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: payeeQuery.trim(),
          match_type: matchType || "contains",
        });
        if (localDir) params.set("direction", localDir);
        const res = await fetch(
          `/api/operator/treasury/clients/${clientUserId}/rules/payee-stats?${params}`
        );
        const data = (await res.json()) as RulePayeeStats & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Stats failed");
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) {
          setStats(null);
          setError(e instanceof Error ? e.message : "Stats failed");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientUserId, payeeQuery, matchType, localDir]);

  useEffect(() => {
    if (!open || !payeeQuery.trim()) return;
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams({
        q: payeeQuery.trim(),
        match_type: matchType || "contains",
        labeled: "false",
        limit: "1",
      });
      if (localDir) params.set("direction", localDir);
      if (localMin) params.set("amount_min", localMin);
      if (localMax) params.set("amount_max", localMax);
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules/preview?${params}`
      );
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { will_suggest?: number; willSuggest?: number };
      if (!cancelled) {
        setWillSuggest(data.will_suggest ?? data.willSuggest ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientUserId, payeeQuery, matchType, localDir, localMin, localMax]);

  const periods = view === "month" ? stats?.by_month ?? [] : stats?.by_week ?? [];
  const maxCount = useMemo(
    () => Math.max(1, ...periods.map((p) => p.count)),
    [periods]
  );

  const degenerate = !stats || stats.total === 0;
  const single = stats?.total === 1;

  if (!open) return null;

  return (
    <div className="rule-analyze-backdrop" role="dialog" aria-modal="true">
      <div className="rule-analyze-panel">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-medium">Analyze amounts</h3>
          <button type="button" className="ra" onClick={onClose}>
            Close
          </button>
        </div>

        {busy ? <p className="text-sm text-codex-muted">Loading…</p> : null}
        {error ? <p className="text-sm text-cinnabar">{error}</p> : null}

        {stats ? (
          <>
            <p className="text-sm mb-2">
              {stats.total.toLocaleString()} match this payee ·{" "}
              {stats.will_suggest.toLocaleString()} will be suggested
              {willSuggest != null &&
              (localMin || localMax) &&
              willSuggest !== stats.will_suggest
                ? ` · ${willSuggest.toLocaleString()} with this band`
                : null}
            </p>
            <p className="text-xs text-codex-muted mb-3">
              Active-period averages · month{" "}
              {stats.points_per_period.avg_per_active_month != null
                ? Number(stats.points_per_period.avg_per_active_month).toFixed(1)
                : "—"}{" "}
              · week{" "}
              {stats.points_per_period.avg_per_active_week != null
                ? Number(stats.points_per_period.avg_per_active_week).toFixed(1)
                : "—"}
            </p>

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                className={view === "month" ? "btn text-xs" : "btn btn-secondary text-xs"}
                onClick={() => setView("month")}
              >
                By month
              </button>
              <button
                type="button"
                className={view === "week" ? "btn text-xs" : "btn btn-secondary text-xs"}
                onClick={() => setView("week")}
              >
                By week
              </button>
            </div>

            <ul className="rule-analyze-bars mb-3">
              {periods.map((p) => (
                <li key={p.period}>
                  <span className="period">{p.period}</span>
                  <span
                    className="bar"
                    style={{ width: `${(p.count / maxCount) * 100}%` }}
                    title={`n=${p.count} min=${p.min} max=${p.max} σ=${p.stddev}`}
                  />
                  <span className="meta">
                    {p.count} · {Number(p.min).toFixed(0)}–{Number(p.max).toFixed(0)} · σ{" "}
                    {Number(p.stddev).toFixed(0)}
                  </span>
                </li>
              ))}
              {periods.length === 0 ? (
                <li className="text-xs text-codex-muted">No dated periods</li>
              ) : null}
            </ul>

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={degenerate}
                onClick={() => {
                  setLocalMin("");
                  setLocalMax("");
                  onSuggestAll();
                }}
              >
                Suggest all
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={degenerate || stats.mean == null}
                onClick={() => {
                  if (single && stats.min != null) {
                    setLocalMin(round2(stats.min));
                    setLocalMax(round2(stats.min));
                    return;
                  }
                  const mean = Number(stats.mean);
                  const sd = Number(stats.stddev ?? 0);
                  setLocalMin(round2(Math.max(0, mean - sd)));
                  setLocalMax(round2(mean + sd));
                }}
              >
                Typical
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={degenerate || stats.p25 == null}
                onClick={() => {
                  if (single && stats.min != null) {
                    setLocalMin(round2(stats.min));
                    setLocalMax(round2(stats.min));
                    return;
                  }
                  setLocalMin(round2(Number(stats.p25)));
                  setLocalMax(round2(Number(stats.p75)));
                }}
              >
                Tight
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <label className="text-xs">
                Amount min
                <input
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={localMin}
                  onChange={(e) => setLocalMin(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="text-xs">
                Amount max
                <input
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={localMax}
                  onChange={(e) => setLocalMax(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="text-xs">
                Direction
                <select
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={localDir}
                  onChange={(e) =>
                    setLocalDir(e.target.value as "in" | "out" | "")
                  }
                >
                  <option value="">Any</option>
                  <option value="in">Money in</option>
                  <option value="out">Money out</option>
                </select>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn text-sm"
                disabled={degenerate}
                onClick={() =>
                  onApplyBand({
                    amountMin: localMin,
                    amountMax: localMax,
                    direction: localDir,
                  })
                }
              >
                Use this band
              </button>
              <button type="button" className="btn btn-secondary text-sm" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
