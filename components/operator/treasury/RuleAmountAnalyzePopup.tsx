"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RulePayeeStats } from "@/lib/treasury/rule-predicate";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";

export type AnalyzeBandState = {
  amountMin: string;
  amountMax: string;
  direction: "in" | "out" | "";
  dateFrom: string;
  dateTo: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  clientUserId: string;
  payeeQuery: string;
  assignLabel: string;
  ruleName: string;
  matchType?: string;
  sourceTransactionId?: string | null;
  editingRuleId?: string | null;
  initial: AnalyzeBandState;
  onSaved: (opts: {
    suggested: number;
    ruleId: string | null;
    editing: boolean;
  }) => void;
};

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Spec 63F — create/edit lives entirely in this popup. Copy flagged for Ana. */
export function RuleAmountAnalyzePopup({
  open,
  onClose,
  clientUserId,
  payeeQuery,
  assignLabel,
  ruleName,
  matchType = "contains",
  sourceTransactionId,
  editingRuleId,
  initial,
  onSaved,
}: Props) {
  const [stats, setStats] = useState<RulePayeeStats | null>(null);
  const [samples, setSamples] = useState<TreasuryTransactionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  const [localMin, setLocalMin] = useState(initial.amountMin);
  const [localMax, setLocalMax] = useState(initial.amountMax);
  const [localDir, setLocalDir] = useState(initial.direction);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [willSuggest, setWillSuggest] = useState<number | null>(null);

  const loadScoped = useCallback(
    async (scope: AnalyzeBandState, payeeOnly: boolean) => {
      if (!payeeQuery.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: payeeQuery.trim(),
          match_type: matchType || "contains",
        });
        if (!payeeOnly) {
          if (scope.direction) params.set("direction", scope.direction);
          if (scope.amountMin) params.set("amount_min", scope.amountMin);
          if (scope.amountMax) params.set("amount_max", scope.amountMax);
          if (scope.dateFrom) params.set("date_from", scope.dateFrom);
          if (scope.dateTo) params.set("date_to", scope.dateTo);
        } else if (scope.direction) {
          // On open, direction from make-rule may still apply to the broad set
          params.set("direction", scope.direction);
        }

        const previewParams = new URLSearchParams(params);
        previewParams.set("labeled", "false");
        previewParams.set("limit", "5");

        const [statsRes, previewRes] = await Promise.all([
          fetch(
            `/api/operator/treasury/clients/${clientUserId}/rules/payee-stats?${params}`
          ),
          fetch(
            `/api/operator/treasury/clients/${clientUserId}/rules/preview?${previewParams}`
          ),
        ]);
        const statsData = (await statsRes.json()) as RulePayeeStats & {
          error?: string;
        };
        if (!statsRes.ok) throw new Error(statsData.error ?? "Stats failed");
        setStats(statsData);

        if (previewRes.ok) {
          const prev = (await previewRes.json()) as {
            will_suggest?: number;
            willSuggest?: number;
            transactions?: TreasuryTransactionRow[];
          };
          setWillSuggest(prev.will_suggest ?? prev.willSuggest ?? null);
          setSamples(prev.transactions ?? []);
        }
      } catch (e) {
        setStats(null);
        setError(e instanceof Error ? e.message : "Stats failed");
      } finally {
        setBusy(false);
      }
    },
    [clientUserId, payeeQuery, matchType]
  );

  const initialKey = [
    initial.amountMin,
    initial.amountMax,
    initial.direction,
    initial.dateFrom,
    initial.dateTo,
  ].join("|");

  useEffect(() => {
    if (!open) return;
    setLocalMin(initial.amountMin);
    setLocalMax(initial.amountMax);
    setLocalDir(initial.direction);
    setDateFrom(initial.dateFrom);
    setDateTo(initial.dateTo);
    void loadScoped(
      {
        amountMin: initial.amountMin,
        amountMax: initial.amountMax,
        direction: initial.direction,
        dateFrom: initial.dateFrom,
        dateTo: initial.dateTo,
      },
      true
    );
    // Sync only when the dialog opens or the seed band/window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional initialKey
  }, [open, initialKey, loadScoped]);

  const currentScope = (): AnalyzeBandState => ({
    amountMin: localMin,
    amountMax: localMax,
    direction: localDir,
    dateFrom,
    dateTo,
  });

  function runReview() {
    void loadScoped(currentScope(), false);
  }

  async function createOrSave() {
    if (!payeeQuery.trim() || !assignLabel.trim()) {
      setError("Payee and category are required.");
      return;
    }
    if (stats && stats.total === 0) {
      setError("No transactions match — adjust conditions or cancel.");
      return;
    }
    setSaveBusy(true);
    setError(null);
    try {
      const body = {
        name: ruleName.trim() || `Rule: ${assignLabel.trim()}`,
        match_merchant: payeeQuery.trim(),
        assign_label: assignLabel.trim(),
        match_type: matchType || "contains",
        amount_min: localMin ? Number(localMin) : null,
        amount_max: localMax ? Number(localMax) : null,
        direction: localDir || null,
        date_from: dateFrom.trim() || null,
        date_to: dateTo.trim() || null,
        source_transaction_id: sourceTransactionId ?? null,
      };

      const res = editingRuleId
        ? await fetch(
            `/api/operator/treasury/clients/${clientUserId}/rules/${editingRuleId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          )
        : await fetch(
            `/api/operator/treasury/clients/${clientUserId}/rules`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          );

      const data = (await res.json()) as {
        suggested?: number;
        rule?: { id: string };
        error?: string;
        existed?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved({
        suggested: data.suggested ?? 0,
        ruleId: data.rule?.id ?? editingRuleId ?? null,
        editing: Boolean(editingRuleId),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }

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
          <h3 className="text-sm font-medium">
            {editingRuleId ? "Edit conditions" : "Analyze amounts"}
          </h3>
          <button type="button" className="ra" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="text-xs text-codex-muted mb-2">
          Payee contains <strong>{payeeQuery || "—"}</strong> · Category{" "}
          <strong>{assignLabel || "—"}</strong>
        </p>

        {busy ? <p className="text-sm text-codex-muted">Loading…</p> : null}
        {error ? <p className="text-sm text-cinnabar">{error}</p> : null}

        {stats ? (
          <>
            <p className="text-sm mb-2">
              {stats.total.toLocaleString()} match ·{" "}
              {(willSuggest ?? stats.will_suggest).toLocaleString()} will be
              suggested
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
                className={
                  view === "month" ? "btn text-xs" : "btn btn-secondary text-xs"
                }
                onClick={() => setView("month")}
              >
                By month
              </button>
              <button
                type="button"
                className={
                  view === "week" ? "btn text-xs" : "btn btn-secondary text-xs"
                }
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
                  />
                  <span className="meta">
                    {p.count} · {Number(p.min).toFixed(0)}–
                    {Number(p.max).toFixed(0)} · σ {Number(p.stddev).toFixed(0)}
                  </span>
                </li>
              ))}
              {periods.length === 0 ? (
                <li className="text-xs text-codex-muted">No dated periods</li>
              ) : null}
            </ul>

            {samples.length > 0 ? (
              <ul className="preview-list mb-3">
                {samples.map((tx) => (
                  <li key={tx.id}>
                    <span className="pl-d">{tx.posted_date ?? "—"}</span>
                    <span className="pl-p">
                      {tx.merchant_name ?? tx.normalized_merchant ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap gap-2 mb-3">
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={degenerate}
                onClick={() => {
                  setLocalMin("");
                  setLocalMax("");
                  setTimeout(() => {
                    void loadScoped(
                      {
                        amountMin: "",
                        amountMax: "",
                        direction: localDir,
                        dateFrom,
                        dateTo,
                      },
                      false
                    );
                  }, 0);
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
                  } else {
                    const mean = Number(stats.mean);
                    const sd = Number(stats.stddev ?? 0);
                    setLocalMin(round2(Math.max(0, mean - sd)));
                    setLocalMax(round2(mean + sd));
                  }
                  setTimeout(runReview, 0);
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
                  } else {
                    setLocalMin(round2(Number(stats.p25)));
                    setLocalMax(round2(Number(stats.p75)));
                  }
                  setTimeout(runReview, 0);
                }}
              >
                Tight
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2 sm:grid-cols-3">
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
              <label className="text-xs">
                From
                <input
                  type="date"
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label className="text-xs">
                To
                <input
                  type="date"
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                className="btn btn-secondary text-sm"
                disabled={busy || !payeeQuery.trim()}
                onClick={runReview}
              >
                Review
              </button>
              <button
                type="button"
                className="btn text-sm"
                disabled={
                  saveBusy ||
                  !payeeQuery.trim() ||
                  !assignLabel.trim() ||
                  degenerate
                }
                onClick={() => void createOrSave()}
              >
                {saveBusy
                  ? "Saving…"
                  : editingRuleId
                    ? "Save conditions"
                    : "Create rule"}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-sm"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
