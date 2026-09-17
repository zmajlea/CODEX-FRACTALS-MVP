"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CategoryPicker } from "@/components/operator/treasury/CategoryPicker";
import { CategoryPhoneSheet } from "@/components/operator/treasury/CategoryPhoneSheet";
import { RulePhonePortal } from "@/components/operator/treasury/RulePhonePortal";
import type {
  RulePayeePeriodStat,
  RulePayeeStats,
} from "@/lib/treasury/rule-predicate";
import { intersectDateRanges } from "@/lib/treasury/period-bounds";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import { useRulesPhone } from "@/lib/ui/useMaxWidth";

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
  const [periodTotal, setPeriodTotal] = useState<number | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<RulePayeePeriodStat | null>(
    null
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipDebounceRef = useRef(false);
  const isPhone = useRulesPhone();
  const [phoneStep, setPhoneStep] = useState<"edit" | "review">("edit");
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [looseTotal, setLooseTotal] = useState<number | null>(null);

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
      // Spec B16F2: fetch ALL matches so already-categorized rows are visible.
      // will_suggest remains uncategorized-only (API still returns both).
      params.set("limit", String(LIVE_LIST_LIMIT));

      const previewRes = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules/preview?${params}`
      );
      if (previewRes.ok) {
        const prev = (await previewRes.json()) as {
          total?: number;
          will_suggest?: number;
          willSuggest?: number;
          transactions?: TreasuryTransactionRow[];
        };
        const ws = prev.will_suggest ?? null;
        const tot = prev.total ?? (prev.transactions?.length ?? 0);
        if (period) {
          setPeriodWillSuggest(ws);
          setPeriodTotal(tot);
        } else {
          setWillSuggest(ws);
          setPeriodWillSuggest(null);
          setPeriodTotal(null);
        }
        setSamples(sortTxNewestFirst(prev.transactions ?? []));
      } else {
        if (period) {
          setPeriodWillSuggest(null);
          setPeriodTotal(null);
        } else setWillSuggest(null);
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
        const loose =
          !scope.amountMin &&
          !scope.amountMax &&
          !scope.direction &&
          !scope.dateFrom &&
          !scope.dateTo;
        if (loose) {
          // looseTotal set after stats via effect below
        }
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
    setPeriodTotal(null);
    setError(null);
    setPhoneStep("edit");
    setConditionsOpen(
      Boolean(
        initial.amountMin ||
          initial.amountMax ||
          initial.direction ||
          initial.dateFrom ||
          initial.dateTo
      )
    );
    setCatSheetOpen(false);
    setShowAllMatches(false);
    setLooseTotal(null);
    if (!payeeQueryProp.trim()) {
      setStats(null);
      setSamples([]);
      setWillSuggest(null);
      setPeriodWillSuggest(null);
      setPeriodTotal(null);
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
    }, isPhone ? 250 : 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey drives reload
  }, [open, filterKey, refreshAll, isPhone]);

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
        name:
          localName.trim() ||
          (localPayee.trim() && localLabel.trim()
            ? `${localPayee.trim()} → ${localLabel.trim()}`
            : `Rule: ${localLabel.trim()}`),
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
  const listTotalN = selectedPeriod
    ? (periodTotal ?? selectedPeriod.count)
    : (stats?.total ?? samples.length);
  const listAlreadyN = Math.max(0, listTotalN - listSuggestN);
  const newSamples = samples.filter((tx) => tx.label == null);
  const categorizedSamples = samples.filter((tx) => tx.label != null);
  const degenerate = !stats || (stats.total === 0 && suggestN === 0);

  const hasConditions = Boolean(
    localMin || localMax || localDir || dateFrom || dateTo
  );

  useEffect(() => {
    if (!stats) return;
    if (!hasConditions) {
      setLooseTotal(stats.total);
    }
  }, [stats, hasConditions]);

  const excludedByConditions =
    hasConditions && looseTotal != null
      ? Math.max(0, looseTotal - (stats?.total ?? 0))
      : 0;

  const defaultRuleName = () => {
    const payee = localPayee.trim();
    const cat = localLabel.trim();
    if (payee && cat) return `${payee} → ${cat}`;
    return localName.trim() || (cat ? `Rule: ${cat}` : "Rule");
  };

  if (!open || !mounted) return null;

  if (isPhone) {
    const matchN = stats?.total ?? willSuggest ?? 0;
    const willN = willSuggest ?? stats?.will_suggest ?? 0;
    const visible = showAllMatches ? samples : samples.slice(0, 6);
    const footCount =
      hasConditions && excludedByConditions > 0
        ? `Matches ${matchN.toLocaleString()} transactions · ${excludedByConditions.toLocaleString()} excluded by conditions`
        : `Matches ${matchN.toLocaleString()} transactions`;

    return (
      <>
        <RulePhonePortal open={open} aria-label={editingRuleId ? "Edit rule" : "New rule"}>
          <div className="rm-sheet">
            <div className="rm-appbar">
              <button
                type="button"
                className="rm-ic"
                onClick={() => {
                  if (phoneStep === "review") setPhoneStep("edit");
                  else onClose();
                }}
                aria-label={phoneStep === "review" ? "Back" : "Cancel"}
              >
                {phoneStep === "review" ? "‹" : "×"}
              </button>
              <div className="rm-ttl">
                <h2>
                  {phoneStep === "review"
                    ? "Review rule"
                    : editingRuleId
                      ? "Edit rule"
                      : "New rule"}
                </h2>
                {localPayee.trim() && localLabel.trim() ? (
                  <small>
                    {localPayee.trim()} → {localLabel.trim()}
                  </small>
                ) : null}
              </div>
            </div>

            {phoneStep === "edit" ? (
              <>
                <div className="rm-body">
                  {error ? <p className="rule-analyze-err">{error}</p> : null}
                  <div className="rm-field">
                    <div className="rm-lbl">Match merchant / payee</div>
                    <input
                      className="rm-input"
                      value={localPayee}
                      onChange={(e) => setLocalPayee(e.target.value)}
                      placeholder="When description contains"
                      autoFocus
                    />
                    <p className="rm-hint">
                      Transactions whose description contains this text
                    </p>
                  </div>
                  <div className="rm-field">
                    <div className="rm-lbl">Assign category</div>
                    <button
                      type="button"
                      className="rm-pick"
                      onClick={() => setCatSheetOpen(true)}
                    >
                      {localLabel.trim() ? (
                        <span className="val">{localLabel}</span>
                      ) : (
                        <span className="ph">Choose category</span>
                      )}
                      <span className="chev" aria-hidden>
                        ›
                      </span>
                    </button>
                  </div>

                  {!conditionsOpen ? (
                    <button
                      type="button"
                      className="rm-addrow"
                      onClick={() => setConditionsOpen(true)}
                    >
                      Add conditions
                      <span style={{ fontWeight: 500, color: "var(--mute)" }}>
                        · Amount, direction, dates · optional
                      </span>
                    </button>
                  ) : (
                    <>
                      <div className="rm-cond">
                        <button
                          type="button"
                          className="rm-x"
                          aria-label="Remove direction"
                          onClick={() => setLocalDir("")}
                        >
                          ×
                        </button>
                        <div className="rm-lbl">Direction</div>
                        <div className="rm-seg">
                          <button
                            type="button"
                            className={!localDir ? "on" : undefined}
                            onClick={() => setLocalDir("")}
                          >
                            Any
                          </button>
                          <button
                            type="button"
                            className={localDir === "in" ? "on" : undefined}
                            onClick={() => setLocalDir("in")}
                          >
                            Money in
                          </button>
                          <button
                            type="button"
                            className={localDir === "out" ? "on" : undefined}
                            onClick={() => setLocalDir("out")}
                          >
                            Money out
                          </button>
                        </div>
                      </div>
                      <div className="rm-cond">
                        <button
                          type="button"
                          className="rm-x"
                          aria-label="Remove amount"
                          onClick={() => {
                            setLocalMin("");
                            setLocalMax("");
                          }}
                        >
                          ×
                        </button>
                        <div className="rm-lbl">Amount</div>
                        <div className="rm-amtrow">
                          <input
                            className="rm-input"
                            value={localMin}
                            onChange={(e) => setLocalMin(e.target.value)}
                            inputMode="decimal"
                            placeholder="Min"
                          />
                          <input
                            className="rm-input"
                            value={localMax}
                            onChange={(e) => setLocalMax(e.target.value)}
                            inputMode="decimal"
                            placeholder="Max"
                          />
                        </div>
                        {stats?.min != null && stats?.max != null ? (
                          <p className="rm-hint">
                            Matched range {Number(stats.min).toFixed(0)}–
                            {Number(stats.max).toFixed(0)}
                          </p>
                        ) : null}
                      </div>
                      <div className="rm-cond">
                        <button
                          type="button"
                          className="rm-x"
                          aria-label="Remove dates"
                          onClick={() => {
                            setDateFrom("");
                            setDateTo("");
                          }}
                        >
                          ×
                        </button>
                        <div className="rm-lbl">Date</div>
                        <div className="rm-amtrow">
                          <input
                            type="date"
                            className="rm-input"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                          />
                          <input
                            type="date"
                            className="rm-input"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="rm-foot">
                  <p className="rm-count">
                    <b>{footCount}</b>
                  </p>
                  <button
                    type="button"
                    className="rm-btn primary"
                    disabled={
                      !localPayee.trim() || !localLabel.trim() || busy
                    }
                    onClick={() => {
                      if (!localName.trim()) setLocalName(defaultRuleName());
                      setPhoneStep("review");
                      setShowAllMatches(false);
                    }}
                  >
                    Review {willN > 0 ? willN.toLocaleString() : matchN.toLocaleString()}{" "}
                    matches
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rm-body">
                  {error ? <p className="rule-analyze-err">{error}</p> : null}
                  <div className="rm-card">
                    <div className="rm-k">This rule</div>
                    <p style={{ margin: "0 0 6px" }}>
                      Match merchant / payee contains <b>{localPayee.trim()}</b>
                    </p>
                    {localDir ? (
                      <p style={{ margin: "0 0 6px" }}>
                        Direction:{" "}
                        <b>{localDir === "in" ? "Money in" : "Money out"}</b>
                      </p>
                    ) : null}
                    {localMin || localMax ? (
                      <p style={{ margin: "0 0 6px" }}>
                        Amount:{" "}
                        <b>
                          {localMin || "any"} – {localMax || "any"}
                        </b>
                      </p>
                    ) : null}
                    {dateFrom || dateTo ? (
                      <p style={{ margin: "0 0 6px" }}>
                        Date:{" "}
                        <b>
                          {dateFrom || "…"} → {dateTo || "…"}
                        </b>
                      </p>
                    ) : null}
                    <p style={{ margin: 0 }}>
                      Assign → <b>{localLabel.trim()}</b>
                    </p>
                  </div>

                  <div className="rm-card">
                    <div className="rm-hero-n">{willN.toLocaleString()}</div>
                    <div className="rm-hero-s">
                      transactions will be suggested
                    </div>
                    <div className="rm-stats">
                      <div className="rm-stat">
                        <b>
                          {stats?.min != null
                            ? formatTreasuryMoney(Number(stats.min), "USD")
                            : "—"}
                        </b>
                        <span>Min</span>
                      </div>
                      <div className="rm-stat">
                        <b>
                          {stats?.median != null
                            ? formatTreasuryMoney(Number(stats.median), "USD")
                            : "—"}
                        </b>
                        <span>Median</span>
                      </div>
                      <div className="rm-stat">
                        <b>
                          {stats?.max != null
                            ? formatTreasuryMoney(Number(stats.max), "USD")
                            : "—"}
                        </b>
                        <span>Max</span>
                      </div>
                    </div>
                  </div>

                  <div className="rm-field">
                    <div className="rm-lbl">
                      Rule name <span className="opt">optional</span>
                    </div>
                    <input
                      className="rm-input"
                      value={localName}
                      onChange={(e) => setLocalName(e.target.value)}
                      placeholder={defaultRuleName()}
                    />
                  </div>

                  {visible.map((tx) => (
                    <div key={tx.id} className="rm-txcard">
                      <div className="rm-tx-top">
                        <span className="rm-tx-d">{tx.posted_date ?? "—"}</span>
                        <span
                          className={
                            tx.direction === "in" ? "rm-tx-a in" : "rm-tx-a"
                          }
                        >
                          {tx.direction === "out" ? "−" : ""}
                          {formatTreasuryMoney(
                            Math.abs(Number(tx.amount)),
                            "USD"
                          )}
                        </span>
                      </div>
                      <div className="rm-tx-p">
                        {tx.merchant_name ??
                          tx.normalized_merchant ??
                          tx.description ??
                          "—"}
                      </div>
                    </div>
                  ))}
                  {!showAllMatches && samples.length > 6 ? (
                    <button
                      type="button"
                      className="rm-btn ghost sm"
                      onClick={() => setShowAllMatches(true)}
                    >
                      Show all {samples.length}
                    </button>
                  ) : null}
                </div>
                <div className="rm-foot">
                  <button
                    type="button"
                    className="rm-btn primary"
                    disabled={
                      saveBusy ||
                      !localPayee.trim() ||
                      !localLabel.trim() ||
                      degenerate
                    }
                    onClick={() => {
                      if (!localName.trim()) setLocalName(defaultRuleName());
                      void createOrSave();
                    }}
                  >
                    {saveBusy ? "Saving…" : "Save rule"}
                  </button>
                </div>
              </>
            )}
          </div>
        </RulePhonePortal>
        <CategoryPhoneSheet
          open={catSheetOpen}
          onClose={() => setCatSheetOpen(false)}
          categories={labels}
          value={localLabel}
          onPick={setLocalLabel}
        />
      </>
    );
  }

  const filterCol = (
    <div className="rule-analyze-col rule-analyze-col--filters">
      <section className="rule-analyze-group">
        <h4 className="rule-analyze-group-title">Identity</h4>
        <label className="rule-analyze-field">
          Rule name
          <input
            className="field-input"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="rule-analyze-field">
          Payee contains
          <input
            className="field-input"
            value={localPayee}
            onChange={(e) => setLocalPayee(e.target.value)}
            placeholder="When payee contains"
            autoFocus
          />
        </label>
        <div className="rule-analyze-field">
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
        <label className="rule-analyze-field">
          Min
          <input
            className="field-input"
            value={localMin}
            onChange={(e) => setLocalMin(e.target.value)}
            inputMode="decimal"
            placeholder="Any"
          />
        </label>
        <label className="rule-analyze-field">
          Max
          <input
            className="field-input"
            value={localMax}
            onChange={(e) => setLocalMax(e.target.value)}
            inputMode="decimal"
            placeholder="Any"
          />
        </label>
        <label className="rule-analyze-field">
          Direction
          <select
            className="field-input"
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
        <label className="rule-analyze-field">
          From
          <input
            type="date"
            className="field-input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="rule-analyze-field">
          To
          <input
            type="date"
            className="field-input"
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
        {error ? <p className="rule-analyze-err text-sm">{error}</p> : null}

        {stats ? (
          <div className="rule-analyze-summary">
            <p className="rule-analyze-promise">
              <span className="rule-analyze-promise-n">
                {stats.total.toLocaleString()}
              </span>{" "}
              match ·{" "}
              <span className="rule-analyze-promise-n">
                {suggestN.toLocaleString()}
              </span>{" "}
              will be suggested
            </p>
            <p className="rule-analyze-summary-meta">
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
            <div className="dist-toggle">
              <button
                type="button"
                className={
                  view === "month" ? "btn text-xs" : "btn ghost text-xs"
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
                  view === "week" ? "btn text-xs" : "btn ghost text-xs"
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
                        {p.count}
                        <span
                          className={
                            (p.new_count ?? 0) === 0
                              ? "rule-analyze-new-muted"
                              : undefined
                          }
                        >
                          {" "}
                          · {p.new_count ?? 0} new
                        </span>{" "}
                        · {Number(p.min).toFixed(0)}–
                        {Number(p.max).toFixed(0)} · Δ {Number(p.stddev).toFixed(0)}
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
                    ? `${listSuggestN.toLocaleString()} new of ${listTotalN.toLocaleString()} matches · ${listAlreadyN.toLocaleString()} already categorized${
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
                  {newSamples.map((tx) => (
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
                  {categorizedSamples.map((tx) => (
                    <li key={tx.id} className="is-categorized">
                      <span className="pl-d">{tx.posted_date ?? "—"}</span>
                      <span className="pl-p">
                        {tx.merchant_name ?? tx.normalized_merchant ?? "—"}
                      </span>
                      <span className="pl-a">
                        {formatTreasuryMoney(Number(tx.amount), "USD")}
                        {tx.label ? (
                          <span className="pl-chip"> · {tx.label}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : stats ? (
                <p className="text-xs text-codex-muted">
                  {listTotalN > 0 && listSuggestN === 0
                    ? `All ${listTotalN.toLocaleString()} matches here are already categorized`
                    : "No uncategorized matches for these conditions."}
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
