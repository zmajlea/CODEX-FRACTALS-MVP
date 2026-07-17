"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TreasuryRangeCalendar } from "@/components/operator/treasury/TreasuryRangeCalendar";
import { TreasuryTxRow } from "@/components/operator/treasury/TreasuryTxRow";
import { formatRangeLabel } from "@/lib/treasury/period-bounds";
import type {
  TreasuryBookStats,
  TreasuryDateRange,
  TreasuryDrillRange,
  TreasuryInstitutionView,
  TreasuryTransactionRow,
} from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  institutions: TreasuryInstitutionView[];
  dateRange: TreasuryDateRange;
  onDateRangeChange: (range: TreasuryDateRange) => void;
  drillRange?: TreasuryDrillRange | null;
  onClearDrill?: () => void;
  hasSyncedData?: boolean;
  onMakeRule?: (tx: TreasuryTransactionRow) => void;
  onNeedsLabelCount?: (count: number) => void;
  onOpenRuleQueue?: (ruleId: string) => void;
  ruleBanner?: string | null;
  onDismissBanner?: () => void;
};

type AmountMode = "between" | "exact";
type StatusFilter = "all" | "needs_label" | "suggested" | "labeled";

type AppliedFilters = {
  from?: string;
  to?: string;
  datePreset: TreasuryDateRange["preset"];
  status: StatusFilter;
  q: string;
  accountIds: string[];
  amountMode: AmountMode;
  amountMin: string;
  amountMax: string;
  amountExact: string;
};

function formatBookDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso));
  } catch {
    return iso;
  }
}

export function TreasuryLedgerPanel({
  clientUserId,
  institutions,
  dateRange,
  onDateRangeChange,
  drillRange,
  onClearDrill,
  hasSyncedData = true,
  onMakeRule,
  onNeedsLabelCount,
  onOpenRuleQueue,
  ruleBanner,
  onDismissBanner,
}: Props) {
  const [transactions, setTransactions] = useState<TreasuryTransactionRow[]>([]);
  const [book, setBook] = useState<TreasuryBookStats | null>(null);
  const [total, setTotal] = useState(0);
  const [needsLabelCount, setNeedsLabelCount] = useState(0);
  const [suggestedTotalCount, setSuggestedTotalCount] = useState(0);
  const [labeledCount, setLabeledCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLabel, setBulkLabel] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);

  // Draft (composer) vs applied (query)
  const [draftAccounts, setDraftAccounts] = useState<Set<string>>(new Set());
  const [draftPayeeQ, setDraftPayeeQ] = useState("");
  const [draftAmountMode, setDraftAmountMode] = useState<AmountMode>("between");
  const [draftAmountMin, setDraftAmountMin] = useState("");
  const [draftAmountMax, setDraftAmountMax] = useState("");
  const [draftAmountExact, setDraftAmountExact] = useState("");
  const [draftDateRange, setDraftDateRange] = useState<TreasuryDateRange>(dateRange);

  const [applied, setApplied] = useState<AppliedFilters>(() => ({
    from: undefined,
    to: undefined,
    datePreset: "all",
    status: "all",
    q: "",
    accountIds: [],
    amountMode: "between",
    amountMin: "",
    amountMax: "",
    amountExact: "",
  }));

  useEffect(() => {
    setDraftDateRange(dateRange);
  }, [dateRange]);

  const accountGroups = useMemo(
    () =>
      institutions.map((inst) => ({
        institution: inst.institution_name ?? "Source",
        accounts: inst.accounts,
      })),
    [institutions]
  );

  const allAccountIds = useMemo(
    () => institutions.flatMap((i) => i.accounts.map((a) => a.account_id)),
    [institutions]
  );

  const sourceFilterLabel =
    draftAccounts.size === 0 || draftAccounts.size === allAccountIds.length
      ? "Sources: All"
      : `Sources: ${draftAccounts.size} selected`;

  useEffect(() => {
    if (!sourceOpen) return;
    function onPointer(e: MouseEvent) {
      if (!sourceRef.current?.contains(e.target as Node)) setSourceOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [sourceOpen]);

  const buildParams = useCallback(
    (filters: AppliedFilters, pageNum: number, limit: number) => {
      const params = new URLSearchParams({
        limit: String(limit),
        page: String(pageNum),
      });
      if (filters.status !== "all") params.set("status", filters.status);
      const from = drillRange?.from ?? filters.from;
      const to = drillRange?.to ?? filters.to;
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (filters.q) params.set("q", filters.q);
      if (
        filters.accountIds.length > 0 &&
        filters.accountIds.length < allAccountIds.length
      ) {
        for (const id of filters.accountIds) params.append("account_id", id);
      }
      if (filters.amountMode === "exact" && filters.amountExact.trim()) {
        params.set("amount_exact", filters.amountExact.trim());
      } else if (filters.amountMode === "between") {
        if (filters.amountMin.trim()) params.set("amount_min", filters.amountMin.trim());
        if (filters.amountMax.trim()) params.set("amount_max", filters.amountMax.trim());
      }
      return params;
    },
    [allAccountIds.length, drillRange]
  );

  const load = useCallback(
    async (filters: AppliedFilters, pageNum: number, limit: number) => {
      setLoading(true);
      setError(null);
      const params = buildParams(filters, pageNum, limit);
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions?${params}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          transactions: TreasuryTransactionRow[];
          total: number;
          book?: TreasuryBookStats;
          needsLabelCount: number;
          suggestedCount?: number;
          labeledCount?: number;
          pendingCount: number;
        };
        setTransactions(data.transactions);
        setTotal(data.total ?? 0);
        if (data.book) setBook(data.book);
        setNeedsLabelCount(data.needsLabelCount);
        setSuggestedTotalCount(data.suggestedCount ?? 0);
        setLabeledCount(data.labeledCount ?? 0);
        setPendingCount(data.pendingCount);
        onNeedsLabelCount?.(data.needsLabelCount);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to load transactions");
        setTransactions([]);
      }
      setLoading(false);
    },
    [buildParams, clientUserId, onNeedsLabelCount]
  );

  useEffect(() => {
    void load(applied, page, pageSize);
  }, [applied, page, pageSize, load, drillRange]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/labels`
      );
      if (res.ok) {
        const data = (await res.json()) as { labels: string[] };
        setLabels(data.labels);
      }
    })();
  }, [clientUserId]);

  function composeAppliedFromDraft(
    status: StatusFilter = applied.status,
    qOverride?: string
  ): AppliedFilters {
    const date = draftDateRange;
    const isAll = date.preset === "all" || (!date.from && !date.to);
    return {
      from: isAll ? undefined : date.from,
      to: isAll ? undefined : date.to,
      datePreset: date.preset,
      status,
      q: qOverride !== undefined ? qOverride : draftPayeeQ.trim(),
      accountIds: [...draftAccounts],
      amountMode: draftAmountMode,
      amountMin: draftAmountMin,
      amountMax: draftAmountMax,
      amountExact: draftAmountExact,
    };
  }

  function applyFilters() {
    onDateRangeChange(draftDateRange);
    setPage(0);
    setSelected(new Set());
    setApplied(composeAppliedFromDraft());
  }

  function clearAllFilters() {
    const all: TreasuryDateRange = { preset: "all" };
    setDraftDateRange(all);
    onDateRangeChange(all);
    setDraftAccounts(new Set());
    setDraftPayeeQ("");
    setDraftAmountMode("between");
    setDraftAmountMin("");
    setDraftAmountMax("");
    setDraftAmountExact("");
    setPage(0);
    setSelected(new Set());
    setApplied({
      from: undefined,
      to: undefined,
      datePreset: "all",
      status: "all",
      q: "",
      accountIds: [],
      amountMode: "between",
      amountMin: "",
      amountMax: "",
      amountExact: "",
    });
    onClearDrill?.();
  }

  function setStatusFilter(status: StatusFilter) {
    setPage(0);
    setSelected(new Set());
    setApplied((prev) => ({ ...prev, status }));
  }

  async function patchTx(txId: string, body: Record<string, unknown>) {
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/transactions/${txId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setEditingId(null);
    void load(applied, page, pageSize);
  }

  async function applyBulkLabel() {
    const label = bulkLabel.trim();
    if (!label || selected.size === 0) return;
    if (!confirm(`Apply category "${label}" to ${selected.size} transaction(s)?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions/bulk-label`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionIds: [...selected],
            label,
          }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Bulk label failed");
      }
      setSelected(new Set());
      setBulkLabel("");
      void load(applied, page, pageSize);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk label failed");
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleAccount(id: string, currentlyChecked: boolean) {
    setDraftAccounts((prev) => {
      if (prev.size === 0) {
        if (currentlyChecked) {
          return new Set(allAccountIds.filter((aid) => aid !== id));
        }
        return prev;
      }
      const next = new Set(prev);
      if (currentlyChecked) next.delete(id);
      else next.add(id);
      if (next.size >= allAccountIds.length) return new Set();
      return next;
    });
  }

  const allLoadedSelected =
    transactions.length > 0 && transactions.every((t) => selected.has(t.id));

  const isFiltered =
    applied.status !== "all" ||
    !!applied.q ||
    (applied.accountIds.length > 0 &&
      applied.accountIds.length < allAccountIds.length) ||
    !!applied.from ||
    !!applied.to ||
    !!applied.amountMin ||
    !!applied.amountMax ||
    !!applied.amountExact ||
    !!drillRange;

  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min((page + 1) * pageSize, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (applied.status === "needs_label") {
    activeChips.push({
      key: "status",
      label: "Uncategorized",
      clear: () => setStatusFilter("all"),
    });
  } else if (applied.status === "suggested") {
    activeChips.push({
      key: "status",
      label: "Suggested",
      clear: () => setStatusFilter("all"),
    });
  } else if (applied.status === "labeled") {
    activeChips.push({
      key: "status",
      label: "Categorized",
      clear: () => setStatusFilter("all"),
    });
  }
  if (applied.from && applied.to) {
    activeChips.push({
      key: "date",
      label: formatRangeLabel(applied.from, applied.to),
      clear: () => {
        const all: TreasuryDateRange = { preset: "all" };
        setDraftDateRange(all);
        onDateRangeChange(all);
        setApplied((prev) => ({
          ...prev,
          from: undefined,
          to: undefined,
          datePreset: "all",
        }));
      },
    });
  }
  if (applied.q) {
    activeChips.push({
      key: "q",
      label: applied.q,
      clear: () => {
        setDraftPayeeQ("");
        setApplied((prev) => ({ ...prev, q: "" }));
      },
    });
  }
  if (drillRange) {
    activeChips.push({
      key: "drill",
      label: drillRange.label ?? `${drillRange.from} – ${drillRange.to}`,
      clear: () => onClearDrill?.(),
    });
  }

  return (
    <div className="panel p-4">
      {ruleBanner ? (
        <div className="missgap replied mb-4 flex items-center justify-between gap-3">
          <p className="text-sm">{ruleBanner}</p>
          {onDismissBanner ? (
            <button type="button" className="btn btn-secondary text-xs" onClick={onDismissBanner}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-3">
        <h2 className="font-head text-lg">
          Transactions
          {book ? (
            <span className="text-sm font-normal text-codex-muted ml-2">
              — {book.count.toLocaleString()} transactions ·{" "}
              {formatBookDate(book.first)} → {formatBookDate(book.last)}
              {book.importedAt
                ? ` · imported ${formatBookDate(book.importedAt.slice(0, 10))}`
                : ""}
            </span>
          ) : null}
        </h2>
        <p className="text-xs text-codex-muted mt-1 flex items-center gap-2">
          {loading ? <span className="spinner" aria-hidden /> : null}
          {loading && transactions.length === 0
            ? "Loading…"
            : isFiltered
              ? `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()} (filtered from ${(book?.count ?? total).toLocaleString()})`
              : `Showing ${showingFrom}–${showingTo} of ${total.toLocaleString()}`}
          {loading && transactions.length > 0 ? (
            <span className="sr-only">Loading page…</span>
          ) : null}
        </p>
      </div>

      {selected.size > 0 ? (
        <div className="tx-bulk-bar mb-4 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <input
            list="bulk-label-suggestions"
            className="border rounded px-2 py-1 text-sm min-w-[160px]"
            placeholder="Category"
            value={bulkLabel}
            onChange={(e) => setBulkLabel(e.target.value)}
          />
          <datalist id="bulk-label-suggestions">
            {labels.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={bulkBusy || !bulkLabel.trim()}
            onClick={() => void applyBulkLabel()}
          >
            Apply category to {selected.size}
          </button>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      {!drillRange ? (
        <div className="flex flex-wrap gap-3 mb-3 items-center">
          <TreasuryRangeCalendar
            value={draftDateRange}
            onChange={setDraftDateRange}
            dataEnd={book?.last}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 mb-3 items-end">
        <div className="relative" ref={sourceRef}>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => setSourceOpen((v) => !v)}
          >
            {sourceFilterLabel} ▾
          </button>
          {sourceOpen ? (
            <div className="tx-source-menu">
              <button
                type="button"
                className="tx-source-all"
                onClick={() => setDraftAccounts(new Set())}
              >
                All sources
              </button>
              {accountGroups.map((g) => (
                <div key={g.institution} className="tx-source-group">
                  <p className="tx-source-group-title">{g.institution}</p>
                  {g.accounts.map((acct) => {
                    const checked =
                      draftAccounts.size === 0 ||
                      draftAccounts.has(acct.account_id);
                    return (
                      <label key={acct.account_id} className="tx-source-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAccount(acct.account_id, checked)}
                        />
                        <span>
                          {acct.name ?? "Account"}
                          {acct.mask ? ` · ${acct.mask}` : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-codex-muted">Amount:</span>
          <button
            type="button"
            className={`btn btn-secondary text-xs ${draftAmountMode === "between" ? "on" : ""}`}
            onClick={() => setDraftAmountMode("between")}
          >
            Between
          </button>
          <button
            type="button"
            className={`btn btn-secondary text-xs ${draftAmountMode === "exact" ? "on" : ""}`}
            onClick={() => setDraftAmountMode("exact")}
          >
            Exact
          </button>
          {draftAmountMode === "between" ? (
            <>
              <input
                type="number"
                min={0}
                step="0.01"
                className="border rounded px-2 py-1 text-sm w-24"
                placeholder="Min"
                value={draftAmountMin}
                onChange={(e) => setDraftAmountMin(e.target.value)}
              />
              <span className="text-codex-muted text-xs">–</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="border rounded px-2 py-1 text-sm w-24"
                placeholder="Max"
                value={draftAmountMax}
                onChange={(e) => setDraftAmountMax(e.target.value)}
              />
            </>
          ) : (
            <input
              type="number"
              min={0}
              step="0.01"
              className="border rounded px-2 py-1 text-sm w-28"
              placeholder="Exact"
              value={draftAmountExact}
              onChange={(e) => setDraftAmountExact(e.target.value)}
            />
          )}
        </div>

        <input
          type="search"
          className="border rounded px-2 py-1 text-sm min-w-[200px]"
          placeholder="Payee / memo contains… (Enter)"
          value={draftPayeeQ}
          onChange={(e) => setDraftPayeeQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onDateRangeChange(draftDateRange);
              setPage(0);
              setApplied(composeAppliedFromDraft(applied.status, draftPayeeQ.trim()));
            }
          }}
        />

        <button type="button" className="btn btn-secondary text-xs" onClick={applyFilters}>
          Apply filter
        </button>
      </div>

      {activeChips.length > 0 ? (
        <div className="txactive mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="txa-lbl text-codex-muted">Filtering</span>
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="txchip-active inline-flex items-center gap-1 rounded bg-sealed-bone/60 px-2 py-1"
              onClick={c.clear}
            >
              {c.label} <span className="tca-x">✕</span>
            </button>
          ))}
          <button type="button" className="txa-clear underline" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        {(
          [
            { id: "all" as const, label: `All` },
            {
              id: "needs_label" as const,
              label: `Uncategorized (${needsLabelCount})`,
            },
            {
              id: "suggested" as const,
              label: `Suggested (${suggestedTotalCount})`,
            },
            { id: "labeled" as const, label: `Categorized (${labeledCount})` },
          ] as const
        ).map((opt) => (
          <label key={opt.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="tx-status-filter"
              checked={applied.status === opt.id}
              onChange={() => setStatusFilter(opt.id)}
            />
            {opt.label}
          </label>
        ))}
        <label className="flex items-center gap-1 text-xs text-codex-muted ml-auto">
          Page size
          <select
            className="border rounded px-1 py-0.5"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="panel-note text-cinnabar mb-4" role="alert">
          {error}
        </p>
      ) : null}

      {loading && transactions.length === 0 ? (
        <p className="text-sm text-codex-muted">Loading transactions…</p>
      ) : transactions.length === 0 && !error ? (
        <p className="text-sm text-codex-muted">
          {!hasSyncedData
            ? "No transactions synced yet — Sync from bank or Import CSV."
            : "No transactions match these filters."}
        </p>
      ) : (
        <div className="txtable txtable-extended">
          <div className="txhead">
            <span>
              <input
                type="checkbox"
                aria-label={`Select all loaded (${transactions.length})`}
                checked={allLoadedSelected}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelected(new Set(transactions.map((t) => t.id)));
                  } else {
                    setSelected(new Set());
                  }
                }}
              />
            </span>
            <span>Date</span>
            <span>Source</span>
            <span>Payee / Memo</span>
            <span>Category</span>
            <span className="ta-r">Amount</span>
            <span>Status</span>
          </div>
          {transactions.map((tx) => (
            <TreasuryTxRow
              key={tx.id}
              tx={tx}
              selected={selected.has(tx.id)}
              onToggleSelect={(checked) => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(tx.id);
                  else next.delete(tx.id);
                  return next;
                });
              }}
              editing={editingId === tx.id}
              labelDraft={labelDraft}
              descDraft={descDraft}
              labels={labels}
              onLabelDraftChange={setLabelDraft}
              onDescDraftChange={setDescDraft}
              onSaveLabel={() =>
                void patchTx(tx.id, {
                  label: labelDraft,
                  description: descDraft,
                })
              }
              onConfirm={() => void patchTx(tx.id, { confirmSuggestion: true })}
              onReject={() => void patchTx(tx.id, { rejectSuggestion: true })}
              onStartEdit={() => {
                setEditingId(tx.id);
                setLabelDraft(tx.label ?? "");
                setDescDraft(tx.description ?? "");
              }}
              onMakeRule={onMakeRule ? () => onMakeRule(tx) : undefined}
              onOpenRuleQueue={onOpenRuleQueue}
            />
          ))}
        </div>
      )}

      {pendingCount > 0 ? (
        <p className="text-xs text-codex-muted mt-3">
          {pendingCount} pending transaction{pendingCount === 1 ? "" : "s"} excluded from summary
          totals.
        </p>
      ) : null}

      {total > 0 ? (
        <div className="flex flex-wrap gap-2 items-center mt-4">
          <button
            type="button"
            className="btn btn-secondary text-xs"
            disabled={loading || page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="text-xs text-codex-muted inline-flex items-center gap-2">
            {loading ? <span className="spinner" aria-hidden /> : null}
            Page {page + 1} of {pageCount}
            {loading ? <span aria-live="polite">Loading…</span> : null}
          </span>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            disabled={loading || page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
