"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CategoryPicker } from "@/components/operator/treasury/CategoryPicker";
import { TreasuryRangeCalendar } from "@/components/operator/treasury/TreasuryRangeCalendar";
import { TreasuryTxRow } from "@/components/operator/treasury/TreasuryTxRow";
import { PickButton } from "@/components/operator/treasury/PickButton";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type {
  TreasuryBookStats,
  TreasuryDateRange,
  TreasuryDrillRange,
  TreasuryInstitutionView,
  TreasuryTransactionRow,
} from "@/lib/treasury/types";

type AmountMode = "between" | "exact";
type StatusFilter = "all" | "needs_label" | "suggested" | "labeled";

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
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  onPickTransactions?: (
    draftKind: DraftKind,
    transactionIds: string[]
  ) => void | Promise<void>;
  /** Stage 8a-4 — highlight/scroll to this transaction after load */
  focusTxId?: string | null;
  onFocusTxConsumed?: () => void;
  /** Stage 8a-4 — apply txquery (or similar) filters once on mount */
  seedFilters?: Partial<{
    from: string;
    to: string;
    q: string;
    accountIds: string[];
    amountMin: string;
    amountMax: string;
    amountExact: string;
    status: StatusFilter;
  }> | null;
  /** Demo tenant — illustrative mark on span-line */
  demo?: boolean;
  onSeedFiltersConsumed?: () => void;
};

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

function dollarize(v: string): string {
  const t = v.trim();
  if (!t) return t;
  return /^[\d,]+(\.\d+)?$/.test(t) ? `$${t}` : t;
}

function formatSpanLine(book: TreasuryBookStats): string {
  const parts = [
    `${book.count.toLocaleString()} transaction${book.count === 1 ? "" : "s"}.`,
    `${formatBookDate(book.first)} to ${formatBookDate(book.last)}.`,
    book.last
      ? `Imported ${formatBookDate(book.last)}.`
      : null,
  ].filter(Boolean);
  return parts.join(" ");
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
  onPick,
  onPickTransactions,
  focusTxId,
  onFocusTxConsumed,
  seedFilters,
  onSeedFiltersConsumed,
  demo = false,
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
  const [draftSourceId, setDraftSourceId] = useState("");
  /** Spec 64 E — display-only pin; never counted in status totals. */
  const [pinnedRows, setPinnedRows] = useState<
    Map<string, TreasuryTransactionRow>
  >(() => new Map());

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

  const allAccountIds = useMemo(
    () => institutions.flatMap((i) => i.accounts.map((a) => a.account_id)),
    [institutions]
  );

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

  // Stage 8a-4 — seed filters from a basket txquery jump
  useEffect(() => {
    if (!seedFilters) return;
    const next: AppliedFilters = {
      from: seedFilters.from,
      to: seedFilters.to,
      datePreset: seedFilters.from || seedFilters.to ? "custom" : "all",
      status: seedFilters.status ?? "all",
      q: seedFilters.q ?? "",
      accountIds: seedFilters.accountIds ?? [],
      amountMode: seedFilters.amountExact
        ? "exact"
        : "between",
      amountMin: seedFilters.amountMin ?? "",
      amountMax: seedFilters.amountMax ?? "",
      amountExact: seedFilters.amountExact ?? "",
    };
    setApplied(next);
    setDraftPayeeQ(next.q);
    setDraftAccounts(new Set(next.accountIds));
    setDraftSourceId(next.accountIds.length === 1 ? next.accountIds[0]! : "");
    setDraftAmountMode(next.amountMode);
    setDraftAmountMin(next.amountMin);
    setDraftAmountMax(next.amountMax);
    setDraftAmountExact(next.amountExact);
    if (next.from || next.to) {
      setDraftDateRange({
        preset: "custom",
        from: next.from ?? "",
        to: next.to ?? "",
      });
      onDateRangeChange({
        preset: "custom",
        from: next.from ?? "",
        to: next.to ?? "",
      });
    }
    setPage(0);
    onSeedFiltersConsumed?.();
  }, [seedFilters]); // eslint-disable-line react-hooks/exhaustive-deps -- consume once when seed arrives

  // Stage 8a-4 — scroll/highlight focused row after load
  useEffect(() => {
    if (!focusTxId || loading) return;
    const el = document.querySelector(`[data-tx-id="${CSS.escape(focusTxId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const t = window.setTimeout(() => onFocusTxConsumed?.(), 1600);
    return () => window.clearTimeout(t);
  }, [focusTxId, loading, transactions, onFocusTxConsumed]);

  const refreshLabels = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/labels`
    );
    if (res.ok) {
      const data = (await res.json()) as { labels: string[] };
      setLabels(data.labels);
    }
  }, [clientUserId]);

  useEffect(() => {
    void refreshLabels();
  }, [refreshLabels]);

  function rememberLabel(label: string) {
    const t = label.trim();
    if (!t) return;
    setLabels((prev) =>
      prev.some((l) => l.toLowerCase() === t.toLowerCase())
        ? prev
        : [...prev, t].sort((a, b) => a.localeCompare(b))
    );
  }

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
    // Source select is the account filter — compose from draftSourceId, not stale Set state.
    const accountIds = draftSourceId ? [draftSourceId] : [];
    setDraftAccounts(new Set(accountIds));
    setPage(0);
    setSelected(new Set());
    clearPins();
    setApplied({
      ...composeAppliedFromDraft(),
      accountIds,
    });
  }

  function submitSearch() {
    onDateRangeChange(draftDateRange);
    setPage(0);
    setSelected(new Set());
    setApplied(composeAppliedFromDraft(applied.status, draftPayeeQ.trim()));
  }

  /** Spec — top-level account lens; same state as Advanced → Source. Default All. */
  function setTopAccountFilter(accountId: string) {
    const accountIds = accountId ? [accountId] : [];
    setDraftSourceId(accountId);
    setDraftAccounts(new Set(accountIds));
    setPage(0);
    setSelected(new Set());
    clearPins();
    setApplied((prev) => ({ ...prev, accountIds }));
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
    setDraftSourceId("");
    setPage(0);
    setSelected(new Set());
    clearPins();
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

  function clearPins() {
    setPinnedRows(new Map());
  }

  function setStatusFilter(status: StatusFilter) {
    setPage(0);
    setSelected(new Set());
    clearPins();
    setApplied((prev) => ({ ...prev, status }));
  }

  async function patchTx(txId: string, body: Record<string, unknown>) {
    const before = transactions.find((t) => t.id === txId);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/transactions/${txId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      void load(applied, page, pageSize);
      return;
    }
    if (typeof body.label === "string") rememberLabel(body.label);
    // Spec 64 E — pin just-categorized for display only (needs_label / suggested views).
    if (
      before &&
      (typeof body.label === "string" || body.confirmSuggestion === true) &&
      (applied.status === "needs_label" || applied.status === "suggested")
    ) {
      const label =
        typeof body.label === "string"
          ? body.label
          : before.suggestions?.[0]?.suggested_label ??
            before.suggested_label ??
            before.label;
      const pinned: TreasuryTransactionRow = {
        ...before,
        label: label || before.label,
        suggestion_status: "confirmed",
        has_pending_suggestion: false,
        suggestions: [],
      };
      setPinnedRows((prev) => {
        const next = new Map(prev);
        next.set(txId, pinned);
        return next;
      });
    }
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
      rememberLabel(label);
      setSelected(new Set());
      setBulkLabel("");
      void load(applied, page, pageSize);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk label failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function addSelectionToDraft(draftKind: DraftKind, _pickable: Pickable) {
    if (selected.size === 0 || !onPickTransactions) return;
    setBulkBusy(true);
    try {
      await onPickTransactions(draftKind, [...selected]);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  async function addPickableToDraft(draftKind: DraftKind, pickable: Pickable) {
    if (!onPick) return;
    setBulkBusy(true);
    try {
      await onPick(draftKind, pickable);
    } finally {
      setBulkBusy(false);
    }
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

  const filteredViewPickable = useMemo((): Pickable | null => {
    if (!isFiltered || total <= 0) return null;
    const from = drillRange?.from ?? applied.from;
    const to = drillRange?.to ?? applied.to;
    const params: Record<string, unknown> = {
      status: applied.status,
    };
    if (from) params.from = from;
    if (to) params.to = to;
    if (applied.q.trim()) params.q = applied.q.trim();
    if (
      applied.accountIds.length > 0 &&
      applied.accountIds.length < allAccountIds.length
    ) {
      params.accountIds = applied.accountIds;
    }
    if (applied.amountMode === "exact" && applied.amountExact.trim()) {
      const n = Number(applied.amountExact);
      if (Number.isFinite(n)) params.amountExact = n;
    } else if (applied.amountMode === "between") {
      if (applied.amountMin.trim()) {
        const n = Number(applied.amountMin);
        if (Number.isFinite(n)) params.amountMin = n;
      }
      if (applied.amountMax.trim()) {
        const n = Number(applied.amountMax);
        if (Number.isFinite(n)) params.amountMax = n;
      }
    }
    const parts = [
      `${total.toLocaleString()} transaction${total === 1 ? "" : "s"}`,
    ];
    if (applied.q.trim()) parts.push(applied.q.trim());
    return {
      kind: "txquery",
      params,
      label: parts.join(" · "),
      sublabel: "filtered view",
    };
  }, [isFiltered, total, drillRange, applied, allAccountIds.length]);

  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo = Math.min((page + 1) * pageSize, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Spec 64 E — display-only merge: pins stay on screen; totals stay from API (unchanged).
  const displayRows = useMemo(() => {
    if (pinnedRows.size === 0) return transactions;
    const seen = new Set(transactions.map((t) => t.id));
    const extras: TreasuryTransactionRow[] = [];
    for (const [id, row] of pinnedRows) {
      if (!seen.has(id)) extras.push(row);
    }
    if (extras.length === 0) return transactions;
    return [...extras, ...transactions];
  }, [transactions, pinnedRows]);

  const allStatusCount =
    needsLabelCount + suggestedTotalCount + labeledCount;

  const topAccountValue =
    applied.accountIds.length === 1 && applied.accountIds[0]
      ? applied.accountIds[0]
      : "";

  const accountSelectOptions = useMemo(
    () =>
      institutions.flatMap((inst) =>
        inst.accounts.map((acct) => ({
          id: acct.account_id,
          name:
            acct.mask ??
            acct.name ??
            acct.account_id.replace(/^csv:/, "") ??
            "Account",
        }))
      ),
    [institutions]
  );

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (applied.from || applied.to) {
    activeChips.push({
      key: "date",
      label: `Date: ${formatBookDate(applied.from ?? book?.first ?? null)} to ${formatBookDate(applied.to ?? book?.last ?? null)}`,
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
  if (
    applied.accountIds.length > 0 &&
    applied.accountIds.length < allAccountIds.length
  ) {
    const acctId = applied.accountIds[0]!;
    const acct = institutions
      .flatMap((i) => i.accounts)
      .find((a) => a.account_id === acctId);
    const acctLabel =
      acct?.mask ?? acct?.name ?? acctId.replace(/^csv:/, "");
    activeChips.push({
      key: "source",
      label: `Source: ${acctLabel} CSV import`,
      clear: () => {
        setDraftAccounts(new Set());
        setDraftSourceId("");
        setApplied((prev) => ({ ...prev, accountIds: [] }));
      },
    });
  }
  if (applied.amountMode === "between" && (applied.amountMin || applied.amountMax)) {
    activeChips.push({
      key: "amount",
      label: `Amount: ${dollarize(applied.amountMin || "0")} to ${applied.amountMax ? dollarize(applied.amountMax) : "any"}`,
      clear: () => {
        setDraftAmountMin("");
        setDraftAmountMax("");
        setApplied((prev) => ({
          ...prev,
          amountMin: "",
          amountMax: "",
        }));
      },
    });
  } else if (applied.amountMode === "exact" && applied.amountExact) {
    activeChips.push({
      key: "amount",
      label: `Amount: exactly ${dollarize(applied.amountExact)}`,
      clear: () => {
        setDraftAmountExact("");
        setApplied((prev) => ({ ...prev, amountExact: "" }));
      },
    });
  }
  if (applied.q) {
    activeChips.push({
      key: "payee",
      label: `Payee: ${applied.q}`,
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

  const sourceOptions = useMemo(
    () =>
      institutions.flatMap((inst) =>
        inst.accounts.map((acct) => ({
          id: acct.account_id,
          label: `${acct.mask ?? acct.name ?? acct.account_id.replace(/^csv:/, "")} ${inst.institution_name ?? "CSV import"}`,
        }))
      ),
    [institutions]
  );

  return (
    <>
      {ruleBanner ? (
        <div className="missgap replied mb-4 flex items-center justify-between gap-3">
          <p className="text-sm">{ruleBanner}</p>
          {onDismissBanner ? (
            <button type="button" className="btn ghost text-xs" onClick={onDismissBanner}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="hubhead">
        <div>
          <div className="eyebrow">Treasury record</div>
          <h1 className="title">Transactions</h1>
        </div>
      </div>

      {book ? (
        <p className="span-line">
          {formatSpanLine(book)}
          {demo ? (
            <>
              {" "}
              <span className="mark illustrative">Illustrative</span>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="tx-lens-row">
        <div className="seg" role="group" aria-label="Status filter">
          {(
            [
              { id: "all" as const, label: "All", count: allStatusCount },
              {
                id: "needs_label" as const,
                label: "Uncategorized",
                count: needsLabelCount,
              },
              {
                id: "suggested" as const,
                label: "Suggested",
                count: suggestedTotalCount,
              },
              {
                id: "labeled" as const,
                label: "Confirmed",
                count: labeledCount,
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={applied.status === opt.id}
              onClick={() => setStatusFilter(opt.id)}
            >
              {opt.label} <span className="cnt">{opt.count.toLocaleString()}</span>
            </button>
          ))}
        </div>

        {accountSelectOptions.length > 0 ? (
          <label className="flex items-center gap-2 text-sm" style={{ margin: 0 }}>
            <span className="treasury-meta">Account</span>
            <select
              className="field-input"
              aria-label="Account"
              value={topAccountValue}
              onChange={(e) => setTopAccountFilter(e.target.value)}
            >
              <option value="">All accounts</option>
              {accountSelectOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="tx-search">
          <input
            type="text"
            className="tx-search-in"
            placeholder="Search payee or memo"
            aria-label="Search payee or memo, searches every transaction"
            value={draftPayeeQ}
            onChange={(e) => setDraftPayeeQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
          />
          <button
            type="button"
            className="btn ghost tx-search-btn"
            style={{ padding: "7px 14px" }}
            onClick={submitSearch}
          >
            Search
          </button>
        </div>
      </div>

      {!drillRange ? (
        <details className="adv-filter">
          <summary>Advanced filter</summary>
          <div className="adv-body">
            <div className="txf">
              <span className="txf-l">Date range</span>
              <TreasuryRangeCalendar
                value={draftDateRange}
                onChange={setDraftDateRange}
                dataEnd={book?.last}
              />
            </div>
            <div className="txf">
              <label className="txf-l" htmlFor="txf-src">
                Source
              </label>
              <select
                id="txf-src"
                aria-label="Source"
                value={draftSourceId}
                onChange={(e) => setTopAccountFilter(e.target.value)}
              >
                <option value="">Any source</option>
                {sourceOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="txf">
              <span className="txf-l">Amount</span>
              <div className="txf-amt">
                <div className="mtc" role="group" aria-label="Amount mode">
                  <button
                    type="button"
                    className="txa-between"
                    aria-pressed={draftAmountMode === "between"}
                    onClick={() => setDraftAmountMode("between")}
                  >
                    Between
                  </button>
                  <button
                    type="button"
                    className="txa-exact"
                    aria-pressed={draftAmountMode === "exact"}
                    onClick={() => setDraftAmountMode("exact")}
                  >
                    Exact
                  </button>
                </div>
                <span className="txa-fields">
                  {draftAmountMode === "between" ? (
                    <>
                      <input
                        type="text"
                        className="txa-min"
                        placeholder="Min"
                        aria-label="Minimum amount"
                        value={draftAmountMin}
                        onChange={(e) => setDraftAmountMin(e.target.value)}
                      />
                      <span className="txa-to">to</span>
                      <input
                        type="text"
                        className="txa-max"
                        placeholder="Max"
                        aria-label="Maximum amount"
                        value={draftAmountMax}
                        onChange={(e) => setDraftAmountMax(e.target.value)}
                      />
                    </>
                  ) : (
                    <input
                      type="text"
                      className="txa-ex"
                      placeholder="Amount"
                      aria-label="Exact amount"
                      value={draftAmountExact}
                      onChange={(e) => setDraftAmountExact(e.target.value)}
                    />
                  )}
                </span>
              </div>
            </div>
            <div className="txf">
              <label className="txf-l" htmlFor="txf-pay">
                Payee or memo contains
              </label>
              <input
                id="txf-pay"
                type="text"
                aria-label="Payee or memo contains"
                value={draftPayeeQ}
                onChange={(e) => setDraftPayeeQ(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn ghost tx-apply"
              style={{ padding: "7px 14px" }}
              onClick={applyFilters}
            >
              Apply
            </button>
          </div>
        </details>
      ) : null}

      {activeChips.length > 0 ? (
        <div className="tx-chips">
          {activeChips.map((c) => (
            <span key={c.key} className="filter-chip">
              {c.label}
              <button
                type="button"
                className="fc-x"
                aria-label={`Clear the ${c.key} filter.`}
                onClick={c.clear}
              >
                ×
              </button>
            </span>
          ))}
          {activeChips.length >= 2 ? (
            <button type="button" className="fc-clear" onClick={clearAllFilters}>
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="meta" style={{ margin: "0 0 10px" }}>
        {loading && transactions.length === 0
          ? "Loading…"
          : `Showing ${showingFrom.toLocaleString()} to ${showingTo.toLocaleString()} of ${total.toLocaleString()}.`}
        {filteredViewPickable ? (
          <>
            {" "}
            <PickButton
              variant="header"
              disabled={bulkBusy}
              pickable={filteredViewPickable}
              onPick={addPickableToDraft}
            />
          </>
        ) : null}
      </p>

      {selected.size > 0 ? (
        <div className="tx-bulk-bar mb-4 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <CategoryPicker
            value={bulkLabel}
            categories={labels}
            onChange={setBulkLabel}
            placeholder="Category"
            aria-label="Bulk category"
            disabled={bulkBusy}
            className="min-w-[200px]"
          />
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={bulkBusy || !bulkLabel.trim()}
            onClick={() => void applyBulkLabel()}
          >
            Apply category to {selected.size}
          </button>
          <PickButton
            variant="header"
            disabled={bulkBusy}
            pickable={{
              kind: "transaction",
              label: `${selected.size} transaction${selected.size === 1 ? "" : "s"} selected`,
              sublabel: undefined,
            }}
            onPick={addSelectionToDraft}
          />
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

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
        <table className="dtable">
          <thead>
            <tr>
              <th>
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
              </th>
              <th>Date</th>
              <th>Source</th>
              <th>Payee / memo</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((tx) => (
              <TreasuryTxRow
                key={tx.id}
                tx={tx}
                highlighted={focusTxId === tx.id}
                justCategorized={pinnedRows.has(tx.id)}
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
                onConfirmSuggestion={(ruleId) =>
                  void patchTx(tx.id, {
                    confirmSuggestion: true,
                    ruleId,
                  })
                }
                onRejectSuggestion={(ruleId) =>
                  void patchTx(tx.id, {
                    rejectSuggestion: true,
                    ruleId,
                  })
                }
                onStartEdit={() => {
                  setEditingId(tx.id);
                  setLabelDraft(tx.label ?? "");
                  setDescDraft(tx.description ?? "");
                }}
                onMakeRule={onMakeRule ? () => onMakeRule(tx) : undefined}
                onPick={addPickableToDraft}
              />
            ))}
          </tbody>
        </table>
      )}

      {pendingCount > 0 ? (
        <p className="meta" style={{ marginTop: 12 }}>
          {pendingCount} pending transaction{pendingCount === 1 ? "" : "s"} excluded from summary
          totals.
        </p>
      ) : null}

      <p className="meta" style={{ marginTop: 12 }}>
        Category is editable on every row, including confirmed rows. Money in is green with a plus;
        money out is red with a minus. This is the operator&apos;s view; the raw bank memo shows here
        and is translated to plain language only where a line is cited to a client.
      </p>

      {total > 0 ? (
        <div className="flex flex-wrap gap-2 items-center mt-4">
          <button
            type="button"
            className="btn ghost text-xs"
            disabled={loading || page <= 0}
            onClick={() => {
              clearPins();
              setPage((p) => Math.max(0, p - 1));
            }}
          >
            Previous
          </button>
          <span className="text-xs text-codex-muted inline-flex items-center gap-2">
            {loading ? <span className="spinner" aria-hidden /> : null}
            Page {page + 1} of {pageCount}
            <label className="inline-flex items-center gap-1 ml-2">
              Page size
              <select
                className="border rounded px-1 py-0.5"
                value={pageSize}
                onChange={(e) => {
                  clearPins();
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </label>
          </span>
          <button
            type="button"
            className="btn ghost text-xs"
            disabled={loading || page + 1 >= pageCount}
            onClick={() => {
              clearPins();
              setPage((p) => p + 1);
            }}
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
