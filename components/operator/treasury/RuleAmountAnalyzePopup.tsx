"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CategoryPicker } from "@/components/operator/treasury/CategoryPicker";
import type {
  RulePayeePeriodStat,
  RulePayeeStats,
} from "@/lib/treasury/rule-predicate";
import { intersectDateRanges } from "@/lib/treasury/period-bounds";
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
  labels: string[];
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

function sortTxNewestFirst(rows: TreasuryTransactionRow[]): TreasuryTransactionRow[] {
  return [...rows].sort((a, b) => {
    const da = a.posted_date ?? "";
    const db = b.posted_date ?? "";
    if (da !== db) return db.localeCompare(da);
    return b.id.localeCompare(a.id);
  });
}

function previewDatesForPeriod(
  scope: AnalyzeBandState,
  period: RulePayeePeriodStat | null
): { dateFrom?: string; dateTo?: string } {
  if (!period?.from || !period?.to) return {};
  const { from, to } = intersectDateRanges(
    scope.dateFrom,
    scope.dateTo,
    period.from.slice(0, 10),
    period.to.slice(0, 10)
  );
  if (from > to) return { dateFrom: from, dateTo: from };
  return { dateFrom: from, dateTo: to };
}

/** Spec 63F + 64 + 66 — create/edit in popup; live list shares Spec 63 predicate. */
export function RuleAmountAnalyzePopup({
  open,
  onClose,
  clientUserId,
  labels,
  payeeQuery: payeeQueryProp,
  assignLabel: assignLabelProp,
  ruleName: ruleNameProp,
  matchType = "contains",
  sourceTransactionId,
  editingRuleId,
  initial,
  onSaved,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<RulePayeeStats | null>(null);
  const [samples, setSamples] = useState<TreasuryTransactionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  const [localPayee, setLocalPayee] = useState(payeeQueryProp);
  const [localLabel, setLocalLabel] = useState(assignLabelProp);
  const [localName, setLocalName] = useState(ruleNameProp);
  const [localMin, setLocalMin] = useState(initial.amountMin);
  const [localMax, setLocalMax] = useState(initial.amountMax);
  const [localDir, setLocalDir] = useState(initial.direction);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [willSuggest, setWillSuggest] = useState<number | null>(null);
  const [periodWillSuggest, setPeriodWillSuggest] = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<RulePayeePeriodStat | null>(
    null
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDebounceRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const currentScope = useCallback(
    (): AnalyzeBandState => ({
      amountMin: localMin,
      amountMax: localMax,
      direction: localDir,
      dateFrom,
      dateTo,
    }),
    [localMin, localMax, localDir, dateFrom, dateTo]
  );

  const buildParams = useCallback(
    (scope: AnalyzeBandState, payee: string) => {
      const params = new URLSearchParams({
        q: payee.trim(),
        match_type: matchType || "contains",
      });
      if (scope.direction) params.set("direction", scope.direction);
      if (scope.amountMin) params.set("amount_min", scope.amountMin);
      if (scope.amountMax) params.set("amount_max", scope.amountMax);
      if (scope.dateFrom) params.set("date_from", scope.dateFrom);
      if (scope.dateTo) params.set("date_to", scope.dateTo);
      return params;
    },
    [matchType]
  );

  const loadStats = useCallback(
    async (scope: AnalyzeBandState, payee: string) => {
      if (!payee.trim()) return;
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules/payee-stats?${buildParams(scope, payee)}`
      );
      const statsData = (await res.json()) as RulePayeeStats & { error?: string };
      if (!res.ok) throw new Error(statsData.error ?? "Stats failed");
      setStats(statsData);
    },
    [clientUserId, buildParams]
  );

  const loadPreview = useCallback(
    async (
      scope: AnalyzeBandState,
      payee: string,
      period: RulePayeePeriodStat | null
    ) => {
      if (!payee.trim()) return;
      const params = buildParams(scope, payee);
      const periodDates = previewDatesForPeriod(scope, period);
      if (periodDates.dateFrom) params.set("date_from", periodDates.dateFrom);
      if (periodDates.dateTo) params.set("date_to", periodDates.dateTo);
      params.set("labeled", "false");
      params.set("limit", String(LIVE_LIST_LIMIT));

      const previewRes = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules/preview?${params}`
      );
      if (previewRes.ok) {
        const prev = (await previewRes.json()) as {
          will_suggest?: number;
          willSuggest?: number;
          transactions?: TreasuryTransactionRow[];
        };
        const ws = prev.will_suggest ?? prev.willSuggest ?? null;
        if (period) {
          setPeriodWillSuggest(ws);
        } else {
          setWillSuggest(ws);
          setPeriodWillSuggest(null);
        }
        setSamples(sortTxNewestFirst(prev.transactions ?? []));
      } else {
        if (period) setPeriodWillSuggest(null);
        else setWillSuggest(null);
        setSamples([]);
      }
    },
    [clientUserId, buildParams]
  );

  const refreshAll = useCallback(
    async (
      scope: AnalyzeBandState,
      payee: string,
      period: RulePayeePeriodStat | null
    ) => {
      if (!payee.trim()) return;
      setBusy(true);
      setError(null);
      try {
        await loadStats(scope, payee);
        await loadPreview(scope, payee, period);
      } catch (e) {
        setStats(null);
        setSamples([]);
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setBusy(false);
      }
    },
    [loadStats, loadPreview]
  );

  const identityKey = [
    payeeQueryProp,
    assignLabelProp,
    ruleNameProp,
    initial.amountMin,
    initial.amountMax,
    initial.direction,
    initial.dateFrom,
    initial.dateTo,
  ].join("|");

  useEffect(() => {
    if (!open) return;
    skipDebounceRef.current = true;
    setLocalPayee(payeeQueryProp);
    setLocalLabel(assignLabelProp);
    setLocalName(ruleNameProp);
    setLocalMin(initial.amountMin);
    setLocalMax(initial.amountMax);
    setLocalDir(initial.direction);
    setDateFrom(initial.dateFrom);
    setDateTo(initial.dateTo);
    setSelectedPeriod(null);
    setError(null);
    if (!payeeQueryProp.trim()) {
      setStats(null);
      setSamples([]);
      setWillSuggest(null);
      setPeriodWillSuggest(null);
      return;
    }
    const scope: AnalyzeBandState = {
      amountMin: initial.amountMin,
      amountMax: initial.amountMax,
      direction: initial.direction,
      dateFrom: initial.dateFrom,
      dateTo: initial.dateTo,
    };
    void refreshAll(scope, payeeQueryProp, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional identityKey
  }, [open, identityKey, refreshAll]);

  function runReview() {
    void refreshAll(currentScope(), localPayee, selectedPeriod);
  }

  const filterKey = [
    localPayee,
    localMin,
    localMax,
    localDir,
    dateFrom,
    dateTo,
  ].join("|");

  useEffect(() => {
    if (!open || !localPayee.trim()) return;
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return;
    }
    setSelectedPeriod(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refreshAll(currentScope(), localPayee, null);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey drives reload
  }, [open, filterKey, refreshAll]);

  function selectPeriod(p: RulePayeePeriodStat) {
    const next = selectedPeriod?.period === p.period ? null : p;
    setSelectedPeriod(next);
    void loadPreview(currentScope(), localPayee, next);
  }

  function clearPeriod() {
    setSelectedPeriod(null);
    void loadPreview(currentScope(), localPayee, null);
  }

  async function createOrSave() {
    if (!localPayee.trim() || !localLabel.trim()) {
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
        name: localName.trim() || `Rule: ${localLabel.trim()}`,
        match_merchant: localPayee.trim(),
        assign_label: localLabel.trim(),
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

  const periodsRaw = view === "month" ? stats?.by_month ?? [] : stats?.by_week ?? [];
  const periods = useMemo(
    () => [...periodsRaw].reverse(),
    [periodsRaw]
  );
  const maxCount = useMemo(
    () => Math.max(1, ...periods.map((p) => p.count)),
    [periods]
  );
  const suggestN = willSuggest ?? stats?.will_suggest ?? 0;
  const listSuggestN = selectedPeriod
    ? (periodWillSuggest ?? 0)
    : suggestN;
  const degenerate = !stats || (stats.total === 0 && suggestN === 0);

  if (!open || !mounted) return null;

  const filterCol = (
    <div className="rule-analyze-col rule-analyze-col--filters">
      <section className="rule-analyze-group">
        <h4 className="rule-analyze-group-title">Identity</h4>
        <label className="text-xs">
          Rule name
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="text-xs">
          Payee contains
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            value={localPayee}
            onChange={(e) => setLocalPayee(e.target.value)}
            placeholder="When payee contains"
            autoFocus
          />
        </label>
        <div className="text-xs">
          Category to assign
          <CategoryPicker
            value={localLabel}
            categories={labels}
            onChange={setLocalLabel}
            placeholder="Category to assign"
            aria-label="Category to assign"
          />
        </div>
      </section>

      <section className="rule-analyze-group">
        <h4 className="rule-analyze-group-title">Amount</h4>
        <label className="text-xs">
          Min
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            value={localMin}
            onChange={(e) => setLocalMin(e.target.value)}
            inputMode="decimal"
            placeholder="Any"
          />
        </label>
        <label className="text-xs">
          Max
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
      </section>

      <section className="rule-analyze-group">
        <h4 className="rule-analyze-group-title">Time</h4>
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
      </section>

      <div className="rule-analyze-actions">
        <button
          type="button"
          className="btn text-sm"
          disabled={
            saveBusy ||
            !localPayee.trim() ||
            !localLabel.trim() ||
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
        <button
          type="button"
          className="btn btn-secondary text-sm"
          disabled={busy || !localPayee.trim()}
          onClick={runReview}
        >
          Review
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div data-r1="" data-brand="summit">
      <div
        className="rule-analyze-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-analyze-title"
      >
      <div className="rule-analyze-panel rule-analyze-panel--3col">
        <div className="rule-analyze-head">
          <h3 id="rule-analyze-title" className="text-sm font-medium">
            {editingRuleId ? "Edit conditions" : "Create rule"}
          </h3>
          <button type="button" className="ra" onClick={onClose}>
            Close
          </button>
        </div>

        {busy ? (
          <div
            className="busy-indeterminate"
            role="progressbar"
            aria-busy="true"
            aria-label="Updating matches"
          />
        ) : null}
        {error ? <p className="text-sm text-cinnabar">{error}</p> : null}

        {stats ? (
          <div className="rule-analyze-summary">
            <p className="text-sm">
              {stats.total.toLocaleString()} match ·{" "}
              {suggestN.toLocaleString()} will be suggested
            </p>
            <p className="text-xs text-codex-muted">
              Active-period averages · month{" "}
              {stats.points_per_period.avg_per_active_month != null
                ? Number(stats.points_per_period.avg_per_active_month).toFixed(1)
                : "—"}{" "}
              · week{" "}
              {stats.points_per_period.avg_per_active_week != null
                ? Number(stats.points_per_period.avg_per_active_week).toFixed(1)
                : "—"}
            </p>
          </div>
        ) : null}

        <div className="rule-analyze-cols">
          {filterCol}

          <div className="rule-analyze-col rule-analyze-col--dist">
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                className={
                  view === "month" ? "btn text-xs" : "btn btn-secondary text-xs"
                }
                disabled={!stats}
                onClick={() => {
                  setView("month");
                  setSelectedPeriod(null);
                  void loadPreview(currentScope(), localPayee, null);
                }}
              >
                By month
              </button>
              <button
                type="button"
                className={
                  view === "week" ? "btn text-xs" : "btn btn-secondary text-xs"
                }
                disabled={!stats}
                onClick={() => {
                  setView("week");
                  setSelectedPeriod(null);
                  void loadPreview(currentScope(), localPayee, null);
                }}
              >
                By week
              </button>
            </div>
            {stats ? (
              <ul className="rule-analyze-bars">
                {periods.map((p) => (
                  <li
                    key={p.period}
                    className={
                      selectedPeriod?.period === p.period ? "is-selected" : ""
                    }
                  >
                    <button
                      type="button"
                      className="rule-analyze-bar-btn"
                      onClick={() => selectPeriod(p)}
                    >
                      <span className="period">{p.period}</span>
                      <span
                        className="bar"
                        style={{ width: `${(p.count / maxCount) * 100}%` }}
                      />
                      <span className="meta">
                        {p.count} · {Number(p.min).toFixed(0)}–
                        {Number(p.max).toFixed(0)} · Δ{" "}
                        {Number(p.stddev).toFixed(0)}
                      </span>
                    </button>
                  </li>
                ))}
                {periods.length === 0 ? (
                  <li className="text-xs text-codex-muted">No dated periods</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-xs text-codex-muted">
                Enter a payee to see amount distribution by period.
              </p>
            )}
          </div>

          <div className="rule-analyze-col rule-analyze-col--txs">
            <div className="rule-analyze-live">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs text-codex-muted">
                  {stats
                    ? `${samples.length.toLocaleString()} of ${listSuggestN.toLocaleString()} will be suggested${
                        selectedPeriod ? ` · ${selectedPeriod.period}` : ""
                      }`
                    : "Matching transactions appear here after Review."}
                </p>
                {selectedPeriod ? (
                  <button
                    type="button"
                    className="ra text-xs"
                    onClick={clearPeriod}
                  >
                    Show all
                  </button>
                ) : null}
              </div>
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
              ) : stats ? (
                <p className="text-xs text-codex-muted">
                  No uncategorized matches for these conditions.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}
