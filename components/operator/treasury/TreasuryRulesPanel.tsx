"use client";

import { useCallback, useEffect, useState } from "react";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { TreasuryTxRow } from "@/components/operator/treasury/TreasuryTxRow";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { TreasuryRuleRow, TreasuryTransactionRow } from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  draftRule?: Partial<TreasuryRuleRow> | null;
  onClearDraft?: () => void;
  onGoToTransactions?: () => void;
  /** Stay on Rules; open the new rule’s Suggested queue */
  onRuleSaved?: (suggestedCount: number, ruleId: string | null) => void;
  /** Open this rule’s Suggested queue (ledger return leg) */
  openRuleQueueId?: string | null;
  onOpenRuleQueueConsumed?: () => void;
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

type QueueTab = "suggested" | "confirmed";

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

function queueLine(r: TreasuryRuleRow): string {
  const suggested = r.suggested_count ?? 0;
  const confirmed = r.confirmed_count ?? 0;
  if (r.last_applied_at == null) {
    return `${suggested} suggested · ${confirmed} confirmed · Never applied`;
  }
  const applied = formatAppliedAt(r.last_applied_at);
  return `${suggested} suggested · ${confirmed} confirmed · applied ${applied}`;
}

export function TreasuryRulesPanel({
  clientUserId,
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
  const [msg, setMsg] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>("suggested");
  const [queueRows, setQueueRows] = useState<TreasuryTransactionRow[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // pick via shared onPick (Stage 8b)

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
    if (!draftRule) return;
    setName(draftRule.name ?? `Rule: ${draftRule.assign_label ?? "transaction"}`);
    setMatchMerchant(draftRule.match_merchant ?? "");
    setAssignLabel(draftRule.assign_label ?? "");
    setAmountMin(draftRule.amount_min != null ? String(draftRule.amount_min) : "");
    setAmountMax(draftRule.amount_max != null ? String(draftRule.amount_max) : "");
    setDirection((draftRule.direction as "in" | "out") ?? "");
  }, [draftRule]);

  useEffect(() => {
    if (!openRuleQueueId) return;
    setExpandedId(openRuleQueueId);
    setQueueTab("suggested");
    setQueuePage(0);
    onOpenRuleQueueConsumed?.();
  }, [openRuleQueueId, onOpenRuleQueueConsumed]);

  const loadQueue = useCallback(
    async (ruleId: string, tab: QueueTab, page: number) => {
      setQueueLoading(true);
      const params = new URLSearchParams({
        rule_id: ruleId,
        rule_queue: tab,
        limit: "50",
        page: String(page),
      });
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
      return;
    }
    void loadQueue(expandedId, queueTab, queuePage);
  }, [expandedId, queueTab, queuePage, loadQueue]);

  async function createRule(fromDraft = false) {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/rules`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
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
      error?: string;
    };
    if (!res.ok) {
      setMsg(data.error ?? "Failed to create rule");
      return;
    }
    const count = data.suggested ?? 0;
    const ruleId = data.rule?.id ?? null;
    if (fromDraft) {
      setMsg("Rule saved. Review suggestions below.");
      onClearDraft?.();
      onRuleSaved?.(count, ruleId);
      if (ruleId) {
        setExpandedId(ruleId);
        setQueueTab("suggested");
        setQueuePage(0);
      }
    } else {
      setMsg(`Rule created. ${count} suggestions applied.`);
      onClearDraft?.();
      if (ruleId) {
        setExpandedId(ruleId);
        setQueueTab("suggested");
        setQueuePage(0);
      }
    }
    void load();
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

  async function reapplyRule(rule: TreasuryRuleRow) {
    setBusyRuleId(rule.id);
    setMsg(null);
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
      setMsg(data.error ?? "Re-apply failed");
      return;
    }
    setMsg(`Applied — ${data.suggested ?? 0} new suggestions.`);
    setExpandedId(rule.id);
    setQueueTab("suggested");
    setQueuePage(0);
    void load();
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
    if (expandedId) void loadQueue(expandedId, queueTab, queuePage);
    void load();
  }

  async function confirmAllForRule(rule: TreasuryRuleRow) {
    const n = rule.suggested_count ?? queueTotal;
    if (n <= 0) return;
    if (
      !confirm(
        `Apply the category "${rule.assign_label}" to all ${n} suggested transaction(s)?`
      )
    ) {
      return;
    }
    setConfirmBusy(true);
    try {
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/transactions/bulk-label`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmAllSuggested: true,
            ruleId: rule.id,
          }),
        }
      );
      const data = (await res.json()) as { updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Confirm all failed");
      setMsg(
        `${data.updated ?? 0} transactions confirmed as ${rule.assign_label}.`
      );
      setQueueTab("confirmed");
      setQueuePage(0);
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Confirm all failed");
    } finally {
      setConfirmBusy(false);
    }
  }

  const dirLabel = direction === "in" ? "in" : direction === "out" ? "out" : "any";
  const queuePageCount = Math.max(1, Math.ceil(queueTotal / 50));

  return (
    <div className="space-y-4">
      {draftRule ? (
        <div className="panel p-4 border-l-4 border-amber-400">
          <h3 className="font-head text-lg mb-3">Confirm new rule</h3>
          <p className="text-sm mb-4 leading-relaxed">
            When the payee contains <strong>{matchMerchant || "…"}</strong>, amount{" "}
            <strong>
              {amountMin && amountMax
                ? `${formatTreasuryMoney(Number(amountMin), "USD")}–${formatTreasuryMoney(Number(amountMax), "USD")}`
                : "any"}
            </strong>
            , direction <strong>{dirLabel}</strong> → suggest category{" "}
            <strong>{assignLabel || "…"}</strong>.
          </p>
          <div className="grid gap-2 max-w-lg mb-4">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Rule name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Match merchant"
              value={matchMerchant}
              onChange={(e) => setMatchMerchant(e.target.value)}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Assign category"
              value={assignLabel}
              onChange={(e) => setAssignLabel(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                placeholder="Amount min"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
              <input
                className="border rounded px-2 py-1 text-sm flex-1"
                placeholder="Amount max"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void createRule(true)}
          >
            Save rule &amp; find matches
          </button>
        </div>
      ) : (
        <div className="panel p-4">
          <h3 className="font-head text-lg mb-2">How categorization rules work</h3>
          <ol className="text-sm space-y-2 mb-4 list-decimal list-inside text-codex-muted">
            <li>Categorize a transaction in the ledger</li>
            <li>Make a rule from that categorized row</li>
            <li>Confirm the suggestions it finds</li>
          </ol>
          <p className="text-xs text-codex-muted mb-4">
            Rules propose categories; nothing is applied until you confirm.
          </p>
          {onGoToTransactions ? (
            <button type="button" className="btn" onClick={onGoToTransactions}>
              Go categorize a transaction
            </button>
          ) : null}
        </div>
      )}

      <div className="panel p-4">
        <button
          type="button"
          className="text-sm underline text-codex-muted mb-3"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? "Hide" : "Create a rule manually (advanced)"}
        </button>
        {advancedOpen ? (
          <div className="grid gap-2 max-w-lg">
            <input
              className="border rounded px-2 py-1"
              placeholder="Rule name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="border rounded px-2 py-1"
              placeholder="Match merchant"
              value={matchMerchant}
              onChange={(e) => setMatchMerchant(e.target.value)}
            />
            <input
              className="border rounded px-2 py-1"
              placeholder="Assign category"
              value={assignLabel}
              onChange={(e) => setAssignLabel(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="border rounded px-2 py-1 flex-1"
                placeholder="Amount min"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
              <input
                className="border rounded px-2 py-1 flex-1"
                placeholder="Amount max"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
              />
            </div>
            <select
              className="border rounded px-2 py-1"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "in" | "out" | "")}
            >
              <option value="">Any direction</option>
              <option value="out">Out</option>
              <option value="in">In</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void createRule(false)}
            >
              Save rule
            </button>
          </div>
        ) : null}
        {msg ? <p className="text-sm text-codex-muted mt-3">{msg}</p> : null}
      </div>

      <div className="panel p-4">
        <h3 className="font-head text-lg mb-3">Your rules</h3>
        {rulesLoading ? (
          <p className="text-sm text-codex-muted">Loading rules…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-codex-muted">
            No rules yet — categorize a transaction and use &quot;Make rule&quot; to get
            started.
          </p>
        ) : (
          <ul className="space-y-3">
            {rules.map((r) => {
              const open = expandedId === r.id;
              return (
                <li
                  key={r.id}
                  className="border-b border-sealed-bone/60 pb-3"
                >
                  <div className="flex justify-between gap-4">
                    <button
                      type="button"
                      className="text-left flex-1"
                      onClick={() => {
                        if (open) {
                          setExpandedId(null);
                        } else {
                          setExpandedId(r.id);
                          setQueueTab("suggested");
                          setQueuePage(0);
                        }
                      }}
                    >
                      <p className="text-sm">
                        When payee contains <strong>&quot;{r.match_merchant}&quot;</strong> →
                        Category: <strong>{r.assign_label}</strong>
                      </p>
                      <p className="text-xs text-codex-muted mt-1">
                        {queueLine(r)}
                        {r.active ? " · ACTIVE" : " · PAUSED"}
                      </p>
                      <p className="text-xs text-codex-muted mt-1">{r.name}</p>
                    </button>
                    <div className="flex flex-col gap-1 shrink-0 items-stretch">
                      {onPick ? (
                        <PickButton
                          variant="row"
                          pickable={rulePickable(r)}
                          onPick={onPick}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() => void toggleRule(r)}
                      >
                        {r.active ? "Active" : "Paused"}
                      </button>
                      {r.active ? (
                        <button
                          type="button"
                          className="btn btn-secondary text-xs"
                          disabled={busyRuleId === r.id}
                          onClick={() => void reapplyRule(r)}
                        >
                          {busyRuleId === r.id ? "Applying…" : "Re-apply"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {open ? (
                    <div className="mt-3 pl-1">
                      <div className="flex flex-wrap gap-3 mb-3 text-sm">
                        {(
                          [
                            {
                              id: "suggested" as const,
                              label: `Suggested (${r.suggested_count ?? 0})`,
                            },
                            {
                              id: "confirmed" as const,
                              label: `Confirmed (${r.confirmed_count ?? 0})`,
                            },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={`btn btn-secondary text-xs ${queueTab === t.id ? "on" : ""}`}
                            onClick={() => {
                              setQueueTab(t.id);
                              setQueuePage(0);
                            }}
                          >
                            {t.label}
                          </button>
                        ))}
                        {queueTab === "suggested" && (r.suggested_count ?? 0) > 0 ? (
                          <button
                            type="button"
                            className="btn text-xs"
                            disabled={confirmBusy}
                            onClick={() => void confirmAllForRule(r)}
                          >
                            Confirm all {r.suggested_count}
                          </button>
                        ) : null}
                      </div>

                      {queueLoading ? (
                        <p className="text-sm text-codex-muted">Loading queue…</p>
                      ) : queueRows.length === 0 ? (
                        <p className="text-sm text-codex-muted">
                          No {queueTab} transactions for this rule.
                        </p>
                      ) : (
                        <div className="txtable txtable-extended">
                          <div className="txhead">
                            <span />
                            <span>Date</span>
                            <span>Source</span>
                            <span>Payee / Memo</span>
                            <span>Category</span>
                            <span className="ta-r">Amount</span>
                            <span>Status</span>
                          </div>
                          {queueRows.map((tx) => (
                            <TreasuryTxRow
                              key={tx.id}
                              tx={tx}
                              showSelect={false}
                              onConfirm={() =>
                                void patchTx(tx.id, { confirmSuggestion: true })
                              }
                              onReject={() =>
                                void patchTx(tx.id, { rejectSuggestion: true })
                              }
                            />
                          ))}
                        </div>
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
