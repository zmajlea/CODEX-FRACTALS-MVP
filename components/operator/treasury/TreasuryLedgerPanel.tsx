"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TreasuryRangeCalendar } from "@/components/operator/treasury/TreasuryRangeCalendar";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type {
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
  ruleBanner?: string | null;
  onDismissBanner?: () => void;
};

type AmountMode = "between" | "exact";

function statusChip(tx: TreasuryTransactionRow) {
  if (tx.suggestion_status === "suggested" && tx.suggested_label) {
    return (
      <span className="txchip rev">
        <span className="dot" />
        Suggested
      </span>
    );
  }
  if (tx.label && tx.label_source === "rule_confirmed") {
    return (
      <span className="txchip sld">
        <span className="dot" />
        Rule-confirmed
      </span>
    );
  }
  if (tx.label) {
    return (
      <span className="txchip cln">
        <span className="dot" />
        Labeled
      </span>
    );
  }
  return (
    <span className="txchip rev">
      <span className="dot" />
      Needs label
    </span>
  );
}

function sourceLabel(tx: TreasuryTransactionRow): string {
  const acct = tx.account;
  if (!acct) return "—";
  const name = acct.name ?? "Account";
  return acct.mask ? `${name} · ${acct.mask}` : name;
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
  ruleBanner,
  onDismissBanner,
}: Props) {
  const [transactions, setTransactions] = useState<TreasuryTransactionRow[]>([]);
  const [needsLabelCount, setNeedsLabelCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsLabelOnly, setNeedsLabelOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLabel, setBulkLabel] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [payeeQ, setPayeeQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [amountMode, setAmountMode] = useState<AmountMode>("between");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [amountExact, setAmountExact] = useState("");
  const sourceRef = useRef<HTMLDivElement>(null);

  const effectiveFrom = drillRange?.from ?? dateRange.from;
  const effectiveTo = drillRange?.to ?? dateRange.to;

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
    selectedAccounts.size === 0 || selectedAccounts.size === allAccountIds.length
      ? "Sources: All"
      : `Sources: ${selectedAccounts.size} selected`;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(payeeQ.trim()), 300);
    return () => window.clearTimeout(t);
  }, [payeeQ]);

  useEffect(() => {
    if (!sourceOpen) return;
    function onPointer(e: MouseEvent) {
      if (!sourceRef.current?.contains(e.target as Node)) setSourceOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [sourceOpen]);

  const load = useCallback(
    async (append = false, cursorOverride?: string | null) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: "50" });
      if (needsLabelOnly) params.set("labeled", "false");
      params.set("from", effectiveFrom);
      params.set("to", effectiveTo);
      if (debouncedQ) params.set("q", debouncedQ);
      if (selectedAccounts.size > 0 && selectedAccounts.size < allAccountIds.length) {
        for (const id of selectedAccounts) params.append("account_id", id);
      }
      if (amountMode === "exact" && amountExact.trim()) {
        params.set("amount_exact", amountExact.trim());
      } else if (amountMode === "between") {
        if (amountMin.trim()) params.set("amount_min", amountMin.trim());
        if (amountMax.trim()) params.set("amount_max", amountMax.trim());
      }
      const pageCursor = append ? (cursorOverride ?? cursor) : null;
      if (pageCursor) params.set("cursor", pageCursor);

      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions?${params}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          transactions: TreasuryTransactionRow[];
          nextCursor: string | null;
          needsLabelCount: number;
          pendingCount: number;
        };
        setTransactions((prev) =>
          append ? [...prev, ...data.transactions] : data.transactions
        );
        setCursor(data.nextCursor);
        setNeedsLabelCount(data.needsLabelCount);
        setPendingCount(data.pendingCount);
        onNeedsLabelCount?.(data.needsLabelCount);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to load transactions");
        if (!append) setTransactions([]);
      }
      setLoading(false);
    },
    [
      clientUserId,
      needsLabelOnly,
      effectiveFrom,
      effectiveTo,
      cursor,
      onNeedsLabelCount,
      debouncedQ,
      selectedAccounts,
      allAccountIds.length,
      amountMode,
      amountMin,
      amountMax,
      amountExact,
    ]
  );

  useEffect(() => {
    setCursor(null);
    setSelected(new Set());
    void load(false, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset pagination when filters change
  }, [
    clientUserId,
    needsLabelOnly,
    effectiveFrom,
    effectiveTo,
    debouncedQ,
    selectedAccounts,
    amountMode,
    amountMin,
    amountMax,
    amountExact,
  ]);

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
    void load(false, null);
  }

  async function confirmAllSuggested() {
    const suggested = transactions.filter(
      (t) => t.suggestion_status === "suggested" && t.suggested_label
    );
    if (suggested.length === 0) return;
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/transactions/bulk-label`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds: suggested.map((t) => t.id),
          confirmSuggestions: true,
        }),
      }
    );
    void load(false, null);
  }

  async function applyBulkLabel() {
    const label = bulkLabel.trim();
    if (!label || selected.size === 0) return;
    if (!confirm(`Apply label "${label}" to ${selected.size} transaction(s)?`)) return;
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
      void load(false, null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk label failed");
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleAccount(id: string, currentlyChecked: boolean) {
    setSelectedAccounts((prev) => {
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

  function toggleAllAccounts() {
    setSelectedAccounts(new Set());
  }

  const suggestedCount = transactions.filter(
    (t) => t.suggestion_status === "suggested"
  ).length;

  const allLoadedSelected =
    transactions.length > 0 && transactions.every((t) => selected.has(t.id));

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

      {selected.size > 0 ? (
        <div className="tx-bulk-bar mb-4 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <input
            list="bulk-label-suggestions"
            className="border rounded px-2 py-1 text-sm min-w-[160px]"
            placeholder="Label"
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
            Apply label to {selected.size}
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
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <TreasuryRangeCalendar value={dateRange} onChange={onDateRangeChange} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
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
              <button type="button" className="tx-source-all" onClick={toggleAllAccounts}>
                All sources
              </button>
              {accountGroups.map((g) => (
                <div key={g.institution} className="tx-source-group">
                  <p className="tx-source-group-title">{g.institution}</p>
                  {g.accounts.map((acct) => {
                    const checked =
                      selectedAccounts.size === 0 ||
                      selectedAccounts.has(acct.account_id);
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
            className={`btn btn-secondary text-xs ${amountMode === "between" ? "on" : ""}`}
            onClick={() => setAmountMode("between")}
          >
            Between
          </button>
          <button
            type="button"
            className={`btn btn-secondary text-xs ${amountMode === "exact" ? "on" : ""}`}
            onClick={() => setAmountMode("exact")}
          >
            Exact
          </button>
          {amountMode === "between" ? (
            <>
              <input
                type="number"
                min={0}
                step="0.01"
                className="border rounded px-2 py-1 text-sm w-24"
                placeholder="Min"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
              <span className="text-codex-muted text-xs">–</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="border rounded px-2 py-1 text-sm w-24"
                placeholder="Max"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
              />
            </>
          ) : (
            <input
              type="number"
              min={0}
              step="0.01"
              className="border rounded px-2 py-1 text-sm w-28"
              placeholder="Exact"
              value={amountExact}
              onChange={(e) => setAmountExact(e.target.value)}
            />
          )}
        </div>

        <input
          type="search"
          className="border rounded px-2 py-1 text-sm min-w-[200px]"
          placeholder="Payee / memo contains…"
          value={payeeQ}
          onChange={(e) => setPayeeQ(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={needsLabelOnly}
            onChange={(e) => setNeedsLabelOnly(e.target.checked)}
          />
          Needs label (posted) ({needsLabelCount})
        </label>
        {drillRange ? (
          <span className="inline-flex items-center gap-2 text-xs bg-sealed-bone/50 rounded px-2 py-1">
            Filtered to {drillRange.label ?? `${drillRange.from} – ${drillRange.to}`}
            {onClearDrill ? (
              <button type="button" className="underline" onClick={onClearDrill}>
                Clear
              </button>
            ) : null}
          </span>
        ) : null}
        {suggestedCount > 0 ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void confirmAllSuggested()}
          >
            Confirm all {suggestedCount}
          </button>
        ) : null}
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
            : "No transactions in this period."}
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
            <span>Label</span>
            <span className="ta-r">Amount</span>
            <span>Status</span>
          </div>
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className={`txr ${tx.suggestion_status === "suggested" ? "r-review" : ""}`}
            >
              <span>
                <input
                  type="checkbox"
                  checked={selected.has(tx.id)}
                  aria-label={`Select transaction ${tx.id}`}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(tx.id);
                      else next.delete(tx.id);
                      return next;
                    });
                  }}
                />
              </span>
              <span className="txr-date">{tx.posted_date ?? "—"}</span>
              <span className="txr-source">
                <b title={tx.account?.institution_name ?? undefined}>{sourceLabel(tx)}</b>
                <em>{tx.account?.institution_name ?? ""}</em>
              </span>
              <span className="txr-payee">
                <b>{tx.merchant_name ?? tx.normalized_merchant ?? "—"}</b>
                <em>{tx.raw_name ?? tx.description ?? ""}</em>
                {tx.pending ? <span className="txr-flag">Pending</span> : null}
              </span>
              <span className="txr-catcell">
                {editingId === tx.id ? (
                  <div className="space-y-1 w-full">
                    <input
                      list="label-suggestions"
                      className="w-full border rounded px-2 py-1 text-sm"
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                    />
                    <datalist id="label-suggestions">
                      {labels.map((l) => (
                        <option key={l} value={l} />
                      ))}
                    </datalist>
                    <textarea
                      className="w-full border rounded px-2 py-1 text-xs"
                      rows={2}
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      placeholder="Description"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() =>
                        void patchTx(tx.id, {
                          label: labelDraft,
                          description: descDraft,
                        })
                      }
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <>
                    <span className={`txr-cat ${!tx.label ? "none" : ""}`}>
                      {tx.label ?? "Unlabeled"}
                    </span>
                    {tx.suggestion_status === "suggested" && tx.suggested_label ? (
                      <span className="txr-flag">Suggested: {tx.suggested_label}</span>
                    ) : null}
                  </>
                )}
              </span>
              <span
                className={`txr-amt ta-r ${tx.direction === "in" ? "in" : "out"}`}
              >
                {formatTreasuryMoney(Math.abs(Number(tx.amount)), tx.iso_currency_code)}
              </span>
              <span className="txr-status flex flex-col gap-1 items-start">
                {statusChip(tx)}
                {tx.suggestion_status === "suggested" ? (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => void patchTx(tx.id, { confirmSuggestion: true })}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      onClick={() => void patchTx(tx.id, { rejectSuggestion: true })}
                    >
                      Reject
                    </button>
                  </span>
                ) : !tx.label ? (
                  <button
                    type="button"
                    className="btn btn-secondary text-xs"
                    onClick={() => {
                      setEditingId(tx.id);
                      setLabelDraft(tx.label ?? "");
                      setDescDraft(tx.description ?? "");
                    }}
                  >
                    Label
                  </button>
                ) : onMakeRule ? (
                  <button
                    type="button"
                    className="btn btn-secondary text-xs"
                    onClick={() => onMakeRule(tx)}
                  >
                    Make rule
                  </button>
                ) : null}
                {tx.suggestion_explanation ? (
                  <span className="text-xs text-codex-muted">{tx.suggestion_explanation}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 ? (
        <p className="text-xs text-codex-muted mt-3">
          {pendingCount} pending transaction{pendingCount === 1 ? "" : "s"} excluded from summary
          totals.
        </p>
      ) : null}

      {cursor ? (
        <button
          type="button"
          className="btn btn-secondary mt-4"
          disabled={loading}
          onClick={() => void load(true)}
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
