"use client";

import { useCallback, useEffect, useState } from "react";
import { CategoryPicker } from "@/components/operator/treasury/CategoryPicker";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { TreasuryTxRow } from "@/components/operator/treasury/TreasuryTxRow";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { TreasuryRuleRow, TreasuryTransactionRow } from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  demo?: boolean;
  draftRule?: Partial<TreasuryRuleRow> | null;
  onClearDraft?: () => void;
  onGoToTransactions?: () => void;
  /** Stay on Rules; open the new rule's Suggested queue */
  onRuleSaved?: (suggestedCount: number, ruleId: string | null) => void;
  /** Open this rule's Suggested queue (ledger return leg) */
  openRuleQueueId?: string | null;
  onOpenRuleQueueConsumed?: () => void;
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

type QueueTab = "suggested" | "confirmed" | "rejected";

type RuleQueueFacets = {
  combos: Array<{ labels: string[]; count: number }>;
  confirmed: number;
  rejected: number;
};

type FacetSelection =
  | { kind: "all_suggested" }
  | { kind: "combo"; labels: string[] }
  | { kind: "confirmed" }
  | { kind: "rejected" };

function formatComboBucketLabel(labels: string[]): string {
  if (labels.length === 1) return `${labels[0]} only`;
  return labels.join(" + ");
}

function comboKey(labels: string[]): string {
  return [...labels].sort((a, b) => a.localeCompare(b)).join("\0");
}

type PreviewState = {
  total: number;
  /** Uncategorized (label IS null) matches — what apply will suggest for a new rule. */
  willSuggest: number;
  samples: TreasuryTransactionRow[];
} | null;

/** Spec 56 C — Rules panel feedback by kind (Ana callout / warn-banner). */
type PanelNotice = {
  text: string;
  kind: "notice" | "success" | "error";
} | null;

function NoticeIcon({ kind }: { kind: "notice" | "error" }) {
  return (
    <span className="wb-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        {kind === "error" ? (
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
        ) : (
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        )}
      </svg>
    </span>
  );
}

function formatAppliedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

function formatRuleCounts(r: TreasuryRuleRow): string {
  const suggested = r.suggested_count ?? 0;
  const confirmed = r.confirmed_count ?? 0;
  const applied = r.last_applied_at
    ? `Applied ${formatAppliedAt(r.last_applied_at)}.`
    : "Never applied.";
  return `${suggested} Suggested, ${confirmed} Confirmed. ${applied}`;
}

export function TreasuryRulesPanel({
  clientUserId,
  demo = false,
  draftRule,
  onClearDraft,
  onGoToTransactions,
  onRuleSaved,
  openRuleQueueId,
  onOpenRuleQueueConsumed,
  onPick,
}: Props) {
  const [rules, setRules] = useState<TreasuryRuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [name, setName] = useState("");
  const [matchMerchant, setMatchMerchant] = useState("");
  const [assignLabel, setAssignLabel] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [direction, setDirection] = useState<"in" | "out" | "">("");
  const [notice, setNotice] = useState<PanelNotice>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [facetSel, setFacetSel] = useState<FacetSelection | null>(null);
  const [facets, setFacets] = useState<RuleQueueFacets | null>(null);
  const [facetsMs, setFacetsMs] = useState<number | null>(null);
  const [queueRows, setQueueRows] = useState<TreasuryTransactionRow[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);

  function rulePickable(r: TreasuryRuleRow): Pickable {
    const suggested = r.suggested_count ?? 0;
    const confirmed = r.confirmed_count ?? 0;
    return {
      kind: "rule",
      ref: r.id,
      label: `"${r.match_merchant}" → ${r.assign_label}`,
      sublabel: `${suggested} suggested · ${confirmed} confirmed`,
    };
  }

  const load = useCallback(async () => {
    setRulesLoading(true);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/rules`
    );
    if (res.ok) {
      const data = (await res.json()) as { rules: TreasuryRuleRow[] };
      setRules(data.rules);
    }
    setRulesLoading(false);
  }, [clientUserId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  useEffect(() => {
    if (!draftRule) return;
    setName(draftRule.name ?? `Rule: ${draftRule.assign_label ?? "transaction"}`);
    setMatchMerchant(draftRule.match_merchant ?? "");
    setAssignLabel(draftRule.assign_label ?? "");
    setAmountMin(draftRule.amount_min != null ? String(draftRule.amount_min) : "");
    setAmountMax(draftRule.amount_max != null ? String(draftRule.amount_max) : "");
    setDirection((draftRule.direction as "in" | "out") ?? "");
    setAdvancedOpen(true);
  }, [draftRule]);

  useEffect(() => {
    if (!openRuleQueueId) return;
    setExpandedId(openRuleQueueId);
    setFacetSel(null);
    setQueuePage(0);
    onOpenRuleQueueConsumed?.();
  }, [openRuleQueueId, onOpenRuleQueueConsumed]);

  const loadFacets = useCallback(
    async (ruleId: string): Promise<RuleQueueFacets | null> => {
      const t0 = performance.now();
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules/${ruleId}/facets`
      );
      const ms = Math.round(performance.now() - t0);
      setFacetsMs(ms);
      if (!res.ok) {
        setFacets(null);
        return null;
      }
      const data = (await res.json()) as { facets: RuleQueueFacets };
      setFacets(data.facets);
      return data.facets;
    },
    [clientUserId]
  );

  const loadQueue = useCallback(
    async (
      ruleId: string,
      sel: FacetSelection | null,
      page: number
    ) => {
      setQueueLoading(true);
      const tab: QueueTab =
        sel?.kind === "confirmed"
          ? "confirmed"
          : sel?.kind === "rejected"
            ? "rejected"
            : "suggested";
      const params = new URLSearchParams({
        rule_id: ruleId,
        rule_queue: tab,
        limit: "50",
        page: String(page),
      });
      if (sel?.kind === "combo") {
        for (const label of sel.labels) {
          params.append("combo", label);
        }
      }
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions?${params}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          transactions: TreasuryTransactionRow[];
          total: number;
        };
        setQueueRows(data.transactions);
        setQueueTotal(data.total ?? 0);
      } else {
        setQueueRows([]);
        setQueueTotal(0);
      }
      setQueueLoading(false);
    },
    [clientUserId]
  );

  useEffect(() => {
    if (!expandedId) {
      setQueueRows([]);
      setQueueTotal(0);
      setFacets(null);
      setFacetSel(null);
      return;
    }
    void (async () => {
      await loadFacets(expandedId);
      setFacetSel((prev) => prev ?? { kind: "all_suggested" });
    })();
  }, [expandedId, loadFacets]);

  useEffect(() => {
    if (!expandedId || !facetSel) return;
    void loadQueue(expandedId, facetSel, queuePage);
  }, [expandedId, facetSel, queuePage, loadQueue]);

  async function runPreview() {
    const q = matchMerchant.trim();
    if (!q) {
      setPreview(null);
      return;
    }
    setPreviewBusy(true);
    try {
      const fullParams = new URLSearchParams({ q, limit: "3", page: "0" });
      const uncatParams = new URLSearchParams({
        q,
        labeled: "false",
        limit: "1",
        page: "0",
      });
      const [fullRes, uncatRes] = await Promise.all([
        fetch(
          `/api/operator/treasury/clients/${clientUserId}/transactions?${fullParams}`
        ),
        fetch(
          `/api/operator/treasury/clients/${clientUserId}/transactions?${uncatParams}`
        ),
      ]);
      if (!fullRes.ok) {
        setPreview(null);
        return;
      }
      const fullData = (await fullRes.json()) as {
        transactions: TreasuryTransactionRow[];
        total: number;
      };
      let willSuggest = fullData.total ?? fullData.transactions.length;
      if (uncatRes.ok) {
        const uncatData = (await uncatRes.json()) as { total: number };
        willSuggest = uncatData.total ?? willSuggest;
      }
      setPreview({
        total: fullData.total ?? fullData.transactions.length,
        willSuggest,
        samples: fullData.transactions,
      });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function createRule(fromDraft = false) {
    if (createBusy) return;
    setCreateBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Manual advanced form has no name field — derive so API required-name check passes.
            name: name.trim() || `Rule: ${assignLabel.trim()}`,
            match_merchant: matchMerchant,
            assign_label: assignLabel,
            amount_min: amountMin ? Number(amountMin) : null,
            amount_max: amountMax ? Number(amountMax) : null,
            direction: direction || null,
            match_type: "contains",
            source_transaction_id: draftRule?.source_transaction_id ?? null,
          }),
        }
      );
      const data = (await res.json()) as {
        suggested?: number;
        rule?: TreasuryRuleRow;
        existed?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setNotice({
          kind: "error",
          text: data.error ?? "Failed to create rule",
        });
        return;
      }
      const ruleId = data.rule?.id ?? null;
      if (data.existed) {
        setNotice({
          kind: "notice",
          text: `A rule for "${matchMerchant.trim()} → ${assignLabel.trim()}" already exists.`,
        });
        if (ruleId) {
          setExpandedId(ruleId);
          setFacetSel(null);
          setQueuePage(0);
        }
        void load();
        return;
      }
      const count = data.suggested ?? 0;
      if (fromDraft) {
        setNotice({
          kind: "success",
          text: "Rule saved. Review suggestions below.",
        });
        onClearDraft?.();
        onRuleSaved?.(count, ruleId);
        if (ruleId) {
          setExpandedId(ruleId);
          setFacetSel(null);
          setQueuePage(0);
        }
      } else {
        setNotice({
          kind: "success",
          text: `Rule created. ${count} suggestions applied.`,
        });
        onClearDraft?.();
        if (ruleId) {
          setExpandedId(ruleId);
          setFacetSel(null);
          setQueuePage(0);
        }
      }
      void load();
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleRule(rule: TreasuryRuleRow) {
    await fetch(
      `/api/operator/treasury/clients/${clientUserId}/rules/${rule.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      }
    );
    void load();
  }

  async function deleteRule(rule: TreasuryRuleRow) {
    if (
      !confirm(
        `Delete the rule "${rule.match_merchant} → ${rule.assign_label}"? Any of its suggestions that you have not confirmed will be cleared. Confirmed categories stay.`
      )
    ) {
      return;
    }
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/rules/${rule.id}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({ kind: "error", text: data.error ?? "Delete failed" });
      return;
    }
    if (expandedId === rule.id) setExpandedId(null);
    setNotice({
      kind: "success",
      text: `Deleted rule "${rule.match_merchant} → ${rule.assign_label}".`,
    });
    void load();
  }

  async function reapplyRule(rule: TreasuryRuleRow) {
    setBusyRuleId(rule.id);
    setNotice(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/rules/${rule.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reapply: true }),
      }
    );
    const data = (await res.json()) as { suggested?: number; error?: string };
    setBusyRuleId(null);
    if (!res.ok) {
      setNotice({ kind: "error", text: data.error ?? "Re-apply failed" });
      return;
    }
    setNotice({
      kind: "success",
      text: `Applied — ${data.suggested ?? 0} new suggestions.`,
    });
    setExpandedId(rule.id);
    setFacetSel(null);
    setQueuePage(0);
    void load();
  }

  async function refreshFacetsAndQueue(ruleId: string) {
    const f = await loadFacets(ruleId);
    void load();
    setFacetSel((prev) => {
      if (!prev || prev.kind === "all_suggested") {
        return { kind: "all_suggested" };
      }
      if (prev.kind === "combo" && f) {
        const still = f.combos.find(
          (c) => comboKey(c.labels) === comboKey(prev.labels)
        );
        if (still) return { ...prev };
        return { kind: "all_suggested" };
      }
      return { ...prev };
    });
    setQueuePage(0);
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
    if (expandedId) void refreshFacetsAndQueue(expandedId);
  }

  async function confirmBucket(rule: TreasuryRuleRow, labels: string[]) {
    const n =
      facets?.combos.find((c) => comboKey(c.labels) === comboKey(labels))
        ?.count ?? 0;
    if (n <= 0) return;
    if (
      !confirm(
        `Confirm ${n} transaction(s) in "${formatComboBucketLabel(labels)}" as ${rule.assign_label}?`
      )
    ) {
      return;
    }
    setConfirmBusy(true);
    try {
      // Optimistic decrement
      setFacets((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          combos: prev.combos
            .map((c) =>
              comboKey(c.labels) === comboKey(labels)
                ? { ...c, count: 0 }
                : c
            )
            .filter((c) => c.count > 0),
          confirmed: prev.confirmed + n,
        };
      });
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/rules/${rule.id}/confirm-bucket`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ combo: labels }),
        }
      );
      const data = (await res.json()) as {
        confirmed?: number;
        facets?: RuleQueueFacets;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Confirm bucket failed");
      if (data.facets) setFacets(data.facets);
      setNotice({
        kind: "success",
        text: `${data.confirmed ?? 0} confirmed as ${rule.assign_label}.`,
      });
      setFacetSel({ kind: "confirmed" });
      setQueuePage(0);
      void load();
    } catch (e) {
      setNotice({
        kind: "error",
        text: e instanceof Error ? e.message : "Confirm bucket failed",
      });
      if (expandedId) void loadFacets(expandedId);
    } finally {
      setConfirmBusy(false);
    }
  }

  const queuePageCount = Math.max(1, Math.ceil(queueTotal / 50));

  return (
    <>
      <div className="hubhead">
        <div>
          <div className="eyebrow">Treasury record</div>
          <h1 className="title">Rules</h1>
        </div>
      </div>

      <p className="span-line">
        Turn a one-off categorization into a pattern, so the next lines like it are
        recognized for you to confirm.
        {demo ? (
          <>
            {" "}
            <span className="mark illustrative">Illustrative</span>
          </>
        ) : null}
      </p>

      <div className="explainer">
        <h2>How categorization rules work</h2>
        <ol>
          <li>Categorize a transaction in the ledger.</li>
          <li>Make a rule from that categorized row.</li>
          <li>Confirm the suggestions it finds.</li>
        </ol>
        <p className="promise">
          Rules propose categories; nothing is applied until you confirm.
        </p>
        {onGoToTransactions ? (
          <button type="button" className="btn" onClick={onGoToTransactions}>
            Go categorize a transaction
          </button>
        ) : null}
      </div>

      <details
        className="adv-filter"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Create a rule manually (advanced)</summary>
        <div className="grid gap-2 max-w-lg mt-2">
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            placeholder="When payee contains"
            value={matchMerchant}
            onChange={(e) => setMatchMerchant(e.target.value)}
          />
          <CategoryPicker
            value={assignLabel}
            categories={labels}
            onChange={setAssignLabel}
            placeholder="Category to assign"
            aria-label="Category to assign"
          />
          <button
            type="button"
            className="btn btn-secondary text-sm w-fit"
            disabled={previewBusy || !matchMerchant.trim()}
            onClick={() => void runPreview()}
          >
            {previewBusy ? "Previewing…" : "Preview matches"}
          </button>
          {preview ? (
            <div className="preview" aria-live="polite">
              <div
                className={
                  preview.total > 0 ? "preview-count" : "preview-count zero"
                }
              >
                {preview.total > 0
                  ? `${preview.total.toLocaleString()} match · ${preview.willSuggest.toLocaleString()} will be suggested`
                  : "No transactions match this rule yet."}
              </div>
              {preview.total > 0 ? (
                <>
                  <div className="preview-basis">
                    Full book match · uncategorized rows will be suggested.
                  </div>
                  <ul className="preview-list">
                    {preview.samples.map((tx) => (
                      <li key={tx.id}>
                        <span className="pl-d">{tx.posted_date ?? "—"}</span>
                        <span className="pl-p">
                          {tx.merchant_name ?? tx.normalized_merchant ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="btn text-sm w-fit"
            disabled={
              createBusy || !matchMerchant.trim() || !assignLabel.trim()
            }
            onClick={() => void createRule(Boolean(draftRule))}
          >
            {createBusy
              ? "Saving…"
              : draftRule
                ? "Save rule & find matches"
                : "Save rule"}
          </button>
        </div>
      </details>

      {notice ? (
        notice.kind === "success" ? (
          <div className="callout" role="status" aria-live="polite">
            <span className="co-dot" aria-hidden="true" />
            <div className="co-t">
              <b>{notice.text}</b>
            </div>
          </div>
        ) : (
          <div
            className={
              notice.kind === "error" ? "warn-banner is-error" : "warn-banner"
            }
            role={notice.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            <NoticeIcon kind={notice.kind === "error" ? "error" : "notice"} />
            <span>{notice.text}</span>
          </div>
        )
      ) : null}

      <h2 className="rs-h">Your rules</h2>

      {rulesLoading ? (
        <p className="text-sm text-codex-muted">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-codex-muted">
          No rules yet — categorize a transaction and use + rule to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => {
            const open = expandedId === r.id;
            return (
              <div key={r.id} className="rule-card">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => {
                    if (open) setExpandedId(null);
                    else {
                      setExpandedId(r.id);
                      setFacetSel(null);
                      setQueuePage(0);
                    }
                  }}
                >
                  <div className="rc-logic">
                    When payee contains <span className="k">{r.match_merchant}</span>,
                    Category: <span className="k">{r.assign_label}</span>
                  </div>
                  <div className="rc-counts">{formatRuleCounts(r)}</div>
                </button>
                <div className="rc-foot">
                  <button
                    type="button"
                    className={`chip ${r.active ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleRule(r);
                    }}
                  >
                    {r.active ? <span className="dot" /> : null}
                    {r.active ? "Active" : "Paused"}
                  </button>
                  {r.active ? (
                    <button
                      type="button"
                      className="ra"
                      disabled={busyRuleId === r.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void reapplyRule(r);
                      }}
                    >
                      {busyRuleId === r.id ? "Applying…" : "Re-apply"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ra"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteRule(r);
                    }}
                  >
                    Delete
                  </button>
                  {onPick ? (
                    <PickButton
                      variant="row-draft"
                      pickable={rulePickable(r)}
                      onPick={onPick}
                      buttonClassName="row-pick"
                    />
                  ) : null}
                </div>

                {open ? (
                  <div className="mt-3 border-t border-sealed-bone/60 pt-3">
                    <div className="mb-3">
                      <p className="text-xs text-codex-muted uppercase tracking-wide mb-2">
                        Triage
                        {facetsMs != null ? ` · ${facetsMs}ms` : ""}
                      </p>
                      {/* Ana copy: "All suggested", "Confirm all" — flag for Ana */}
                      <table className="dtable triage-table">
                        <thead>
                          <tr>
                            <th>Bucket</th>
                            <th style={{ textAlign: "right", width: "1%" }}>
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            className={
                              facetSel?.kind === "all_suggested"
                                ? "triage-row on"
                                : "triage-row"
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className="triage-filter"
                                aria-pressed={facetSel?.kind === "all_suggested"}
                                onClick={() => {
                                  setFacetSel({ kind: "all_suggested" });
                                  setQueuePage(0);
                                }}
                              >
                                All suggested
                                <span className="cnt">
                                  {(facets?.combos ?? []).reduce(
                                    (a, c) => a + c.count,
                                    0
                                  ) || (r.suggested_count ?? 0)}
                                </span>
                              </button>
                            </td>
                            <td className="triage-act" />
                          </tr>
                          {(facets?.combos ?? []).map((c) => {
                            const active =
                              facetSel?.kind === "combo" &&
                              comboKey(facetSel.labels) === comboKey(c.labels);
                            return (
                              <tr
                                key={comboKey(c.labels)}
                                className={
                                  active ? "triage-row on" : "triage-row"
                                }
                              >
                                <td>
                                  <button
                                    type="button"
                                    className="triage-filter"
                                    aria-pressed={active}
                                    onClick={() => {
                                      setFacetSel({
                                        kind: "combo",
                                        labels: c.labels,
                                      });
                                      setQueuePage(0);
                                    }}
                                  >
                                    {formatComboBucketLabel(c.labels)}
                                    <span className="cnt">{c.count}</span>
                                  </button>
                                </td>
                                <td className="triage-act">
                                  <button
                                    type="button"
                                    className="ra"
                                    disabled={confirmBusy || c.count === 0}
                                    onClick={() =>
                                      void confirmBucket(r, c.labels)
                                    }
                                  >
                                    Confirm all
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          <tr
                            className={
                              facetSel?.kind === "confirmed"
                                ? "triage-row on"
                                : "triage-row"
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className="triage-filter"
                                aria-pressed={facetSel?.kind === "confirmed"}
                                onClick={() => {
                                  setFacetSel({ kind: "confirmed" });
                                  setQueuePage(0);
                                }}
                              >
                                Already in this category
                                <span className="cnt">
                                  {facets?.confirmed ?? r.confirmed_count ?? 0}
                                </span>
                              </button>
                            </td>
                            <td className="triage-act" />
                          </tr>
                          <tr
                            className={
                              facetSel?.kind === "rejected"
                                ? "triage-row on"
                                : "triage-row"
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className="triage-filter"
                                aria-pressed={facetSel?.kind === "rejected"}
                                onClick={() => {
                                  setFacetSel({ kind: "rejected" });
                                  setQueuePage(0);
                                }}
                              >
                                Rejected
                                <span className="cnt">
                                  {facets?.rejected ?? 0}
                                </span>
                              </button>
                            </td>
                            <td className="triage-act" />
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {queueLoading ? (
                      <p className="text-sm text-codex-muted">Loading queue…</p>
                    ) : queueRows.length === 0 ? (
                      <p className="text-sm text-codex-muted">
                        No transactions in this bucket.
                      </p>
                    ) : (
                      <table className="dtable">
                        <thead>
                          <tr>
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
                          {queueRows.map((tx) => (
                            <TreasuryTxRow
                              key={tx.id}
                              tx={tx}
                              showSelect={false}
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
                            />
                          ))}
                        </tbody>
                      </table>
                    )}

                    {queueTotal > 50 ? (
                      <div className="flex gap-2 items-center mt-3">
                        <button
                          type="button"
                          className="btn btn-secondary text-xs"
                          disabled={queuePage <= 0}
                          onClick={() => setQueuePage((p) => Math.max(0, p - 1))}
                        >
                          Previous
                        </button>
                        <span className="text-xs text-codex-muted">
                          Page {queuePage + 1} of {queuePageCount}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary text-xs"
                          disabled={queuePage + 1 >= queuePageCount}
                          onClick={() => setQueuePage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="meta" style={{ marginTop: 12 }}>
        Suggested and Confirmed mean exactly what they mean on Transactions. Nothing
        labels itself: a rule proposes, you confirm.
      </p>
    </>
  );
}
