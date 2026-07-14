"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { TreasuryRuleRow } from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  draftRule?: Partial<TreasuryRuleRow> | null;
  onClearDraft?: () => void;
  onGoToTransactions?: () => void;
  onRuleSaved?: (suggestedCount: number) => void;
};

export function TreasuryRulesPanel({
  clientUserId,
  draftRule,
  onClearDraft,
  onGoToTransactions,
  onRuleSaved,
}: Props) {
  const [rules, setRules] = useState<TreasuryRuleRow[]>([]);
  const [name, setName] = useState("");
  const [matchMerchant, setMatchMerchant] = useState("");
  const [assignLabel, setAssignLabel] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [direction, setDirection] = useState<"in" | "out" | "">("");
  const [msg, setMsg] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/rules`
    );
    if (res.ok) {
      const data = (await res.json()) as { rules: TreasuryRuleRow[] };
      setRules(data.rules);
    }
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
    const data = (await res.json()) as { suggested?: number; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Failed to create rule");
      return;
    }
    const count = data.suggested ?? 0;
    if (fromDraft) {
      setMsg("Rule saved. This payee is remembered.");
      onClearDraft?.();
      onRuleSaved?.(count);
    } else {
      setMsg(`Rule created. ${count} suggestions applied.`);
      onClearDraft?.();
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

  const dirLabel = direction === "in" ? "in" : direction === "out" ? "out" : "any";

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
            , direction <strong>{dirLabel}</strong> → suggest label{" "}
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
              placeholder="Assign label"
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
          <h3 className="font-head text-lg mb-2">How labeling rules work</h3>
          <ol className="text-sm space-y-2 mb-4 list-decimal list-inside text-codex-muted">
            <li>Label a transaction in the ledger</li>
            <li>Make a rule from that labeled row</li>
            <li>Confirm the suggestions it finds</li>
          </ol>
          <p className="text-xs text-codex-muted mb-4">
            Rules propose labels; nothing is applied until you confirm.
          </p>
          {onGoToTransactions ? (
            <button type="button" className="btn" onClick={onGoToTransactions}>
              Go label a transaction
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
              placeholder="Assign label"
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
            <button type="button" className="btn btn-secondary" onClick={() => void createRule(false)}>
              Save rule
            </button>
          </div>
        ) : null}
        {msg ? <p className="text-sm text-codex-muted mt-3">{msg}</p> : null}
      </div>

      <div className="panel p-4">
        <h3 className="font-head text-lg mb-3">Your rules</h3>
        {rules.length === 0 ? (
          <p className="text-sm text-codex-muted">
            No rules yet — label a transaction and use &quot;Make rule&quot; to get started.
          </p>
        ) : (
          <ul className="space-y-3">
            {rules.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 border-b border-sealed-bone/60 pb-3">
                <div>
                  <p className="text-sm">
                    When payee contains <strong>&quot;{r.match_merchant}&quot;</strong> → suggest{" "}
                    <strong>{r.assign_label}</strong>
                    {typeof r.matched_count === "number" ? (
                      <span className="text-codex-muted"> · matched {r.matched_count}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-codex-muted mt-1">{r.name}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary text-xs shrink-0"
                  onClick={() => void toggleRule(r)}
                >
                  {r.active ? "Active" : "Paused"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
