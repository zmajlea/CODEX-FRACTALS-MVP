"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RulePayeeStats } from "@/lib/treasury/rule-predicate";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";
import { formatTreasuryMoney } from "@/lib/treasury/format";

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

const LIVE_LIST_LIMIT = 50;

/** Spec 63F + 64 — create/edit in popup; live list shares Spec 63 predicate. Copy for Ana. */
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDebounceRef = useRef(false);

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
          params.set("direction", scope.direction);
        }

        // Spec 64 — one shared predicate path: preview RPC with labeled=false.
        // List rows === will_suggest set; "N of M" uses will_suggest as M.
        const previewParams = new URLSearchParams(params);
        previewParams.set("labeled", "false");
        previewParams.set("limit", String(LIVE_LIST_LIMIT));

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
        } else {
          setWillSuggest(null);
          setSamples([]);
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
    skipDebounceRef.current = true;
    setLocalMin(initial.amountMin);
    setLocalMax(initial.amountMax);
    setLocalDir(initial.direction);
    setDateFrom(initial.dateFrom);
    setDateTo(initial.dateTo);
    // Open with current seed scope (empty band = broad). Always apply date/amount if set.
    void loadScoped(
      {
        amountMin: initial.amountMin,
        amountMax: initial.amountMax,
        direction: initial.direction,
        dateFrom: initial.dateFrom,
        dateTo: initial.dateTo,
      },
      false
    );
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

  // Spec 64 G — live list updates as filters change (debounced), same predicate as Review.
  const filterKey = [localMin, localMax, localDir, dateFrom, dateTo].join("|");
  useEffect(() => {
    if (!open || !payeeQuery.trim()) return;
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadScoped(
        {
          amountMin: localMin,
          amountMax: localMax,
          direction: localDir,
          dateFrom,
          dateTo,
        },
        false
      );
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey drives reload
  }, [open, filterKey, payeeQuery, loadScoped]);

  async function createOrSave() {
    if (!payeeQuery.trim() || !assignLabel.trim()) {
      setError("Payee and category are required.");
      return;
    }
    const suggestCount = willSuggest ?? stats?.will_suggest ?? 0;
    if (stats && suggestCount === 0 && stats.total === 0) {
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
  const suggestN = willSuggest ?? stats?.will_suggest ?? 0;
  const degenerate = !stats || (stats.total === 0 && suggestN === 0);

  if (!open) return null;

  return (
    <div className="rule-analyze-backdrop" role="dialog" aria-modal="true">
      <div className="rule-analyze-panel rule-analyze-panel--wide">
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

        {/* Spec 64 C — indeterminate progress during Review / scoped load */}
        {busy ? (
          <div
            className="busy-indeterminate"
            role="progressbar"
            aria-busy="true"
            aria-label="Updating matches"
          />
        ) : null}
        {error ? <p className="text-sm text-cinnabar">{error}</p> : null}

        {/* Spec 64 G — filters at top */}
        <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-3">
          <label className="text-xs">
            Amount min
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              value={localMin}
              onChange={(e) => setLocalMin(e.target.value)}
              inputMode="decimal"
              placeholder="Any"
            />
          </label>
          <label className="text-xs">
            Amount max
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              value={localMax}
              onChange={(e) => setLocalMax(e.target.value)}
              inputMode="decimal"
              placeholder="Any"
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

        <div className="flex flex-wrap gap-2 mb-3">
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

        {stats ? (
          <>
            <p className="text-sm mb-2">
              {stats.total.toLocaleString()} match ·{" "}
              {suggestN.toLocaleString()} will be suggested
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
                  {/* Ana: capital Δ labels the min↔max spread (not σ). */}
                  <span className="meta">
                    {p.count} · Δ {Number(p.min).toFixed(0)}–
                    {Number(p.max).toFixed(0)} · σ {Number(p.stddev).toFixed(0)}
                  </span>
                </li>
              ))}
              {periods.length === 0 ? (
                <li className="text-xs text-codex-muted">No dated periods</li>
              ) : null}
            </ul>

            {/* Spec 64 G — live list under filters; N of M reconciles with will_suggest */}
            <div className="rule-analyze-live mb-3">
              <p className="text-xs text-codex-muted mb-1">
                {samples.length.toLocaleString()} of {suggestN.toLocaleString()}{" "}
                will be suggested
              </p>
              {samples.length > 0 ? (
                <ul className="preview-list">
                  {samples.map((tx) => (
                    <li key={tx.id}>
                      <span className="pl-d">{tx.posted_date ?? "—"}</span>
                      <span className="pl-p">
                        {tx.merchant_name ?? tx.normalized_merchant ?? "—"}
                      </span>
                      <span className="pl-a">
                        {formatTreasuryMoney(Number(tx.amount), "USD")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-codex-muted">
                  No uncategorized matches for these conditions.
                </p>
              )}
            </div>
          </>
        ) : !busy ? (
          <p className="text-sm text-codex-muted">
            Enter a payee and Review to see matches.
          </p>
        ) : null}
      </div>
    </div>
  );
}
