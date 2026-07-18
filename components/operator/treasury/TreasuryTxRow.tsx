"use client";

import { PickButton } from "@/components/operator/treasury/PickButton";
import { formatSuMoney } from "@/lib/treasury/format";
import type { Pickable } from "@/lib/treasury/pickable";
import type { TreasuryTransactionRow } from "@/lib/treasury/types";

export function txStatusChip(tx: TreasuryTransactionRow) {
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
        Categorized
      </span>
    );
  }
  return (
    <span className="txchip rev">
      <span className="dot" />
      Uncategorized
    </span>
  );
}

export function txSourceLabel(tx: TreasuryTransactionRow): string {
  const acct = tx.account;
  if (!acct) return "—";
  const name = acct.name ?? "Account";
  return acct.mask ? `${name} · ${acct.mask}` : name;
}

type Props = {
  tx: TreasuryTransactionRow;
  selected?: boolean;
  onToggleSelect?: (checked: boolean) => void;
  showSelect?: boolean;
  editing?: boolean;
  labelDraft?: string;
  descDraft?: string;
  labels?: string[];
  onLabelDraftChange?: (v: string) => void;
  onDescDraftChange?: (v: string) => void;
  onSaveLabel?: () => void;
  onConfirm?: () => void;
  onReject?: () => void;
  onStartEdit?: () => void;
  onMakeRule?: () => void;
  /** Spec 36 return leg — open the producing rule’s queue */
  onOpenRuleQueue?: (ruleId: string) => void;
  onPick?: (draftKind: import("@/lib/treasury/pickable").DraftKind, pickable: import("@/lib/treasury/pickable").Pickable) => void;
  /** Stage 8a-4 — scroll/highlight target from basket jump */
  highlighted?: boolean;
};

export function TreasuryTxRow({
  tx,
  selected = false,
  onToggleSelect,
  showSelect = true,
  editing = false,
  labelDraft = "",
  descDraft = "",
  labels = [],
  onLabelDraftChange,
  onDescDraftChange,
  onSaveLabel,
  onConfirm,
  onReject,
  onStartEdit,
  onMakeRule,
  onOpenRuleQueue,
  onPick,
  highlighted = false,
}: Props) {
  const payee = tx.merchant_name ?? tx.normalized_merchant ?? "—";
  const rowPickable: Pickable = {
    kind: "transaction",
    ref: tx.id,
    label: payee,
    sublabel: tx.posted_date ?? undefined,
  };

  return (
    <div
      className={`txr ${tx.suggestion_status === "suggested" ? "r-review" : ""}${highlighted ? " focus-hit" : ""}`}
      data-tx-id={tx.id}
    >
      {showSelect ? (
        <span>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select transaction ${tx.id}`}
            onChange={(e) => onToggleSelect?.(e.target.checked)}
          />
        </span>
      ) : (
        <span />
      )}
      <span className="txr-date">{tx.posted_date ?? "—"}</span>
      <span className="txr-source">
        <b title={tx.account?.institution_name ?? undefined}>{txSourceLabel(tx)}</b>
        <em>{tx.account?.institution_name ?? ""}</em>
      </span>
      <span className="txr-payee">
        <b>{tx.merchant_name ?? tx.normalized_merchant ?? "—"}</b>
        <em>{tx.raw_name ?? tx.description ?? ""}</em>
        {tx.pending ? <span className="txr-flag">Pending</span> : null}
        {tx.suggestion_explanation && tx.suggested_by_rule_id && onOpenRuleQueue ? (
          <button
            type="button"
            className="txr-explain text-xs text-left underline text-codex-muted hover:text-ink block mt-1"
            title="Open this rule’s Suggested queue"
            onClick={() => onOpenRuleQueue(tx.suggested_by_rule_id!)}
          >
            {tx.suggestion_explanation}
          </button>
        ) : tx.suggestion_explanation ? (
          <span className="txr-explain text-xs text-codex-muted block mt-1">
            {tx.suggestion_explanation}
          </span>
        ) : null}
      </span>
      <span className="txr-catcell">
        {editing ? (
          <div className="space-y-1 w-full">
            <input
              list={`label-suggestions-${tx.id}`}
              className="w-full border rounded px-2 py-1 text-sm"
              value={labelDraft}
              onChange={(e) => onLabelDraftChange?.(e.target.value)}
            />
            <datalist id={`label-suggestions-${tx.id}`}>
              {labels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <textarea
              className="w-full border rounded px-2 py-1 text-xs"
              rows={2}
              value={descDraft}
              onChange={(e) => onDescDraftChange?.(e.target.value)}
              placeholder="Description"
            />
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => onSaveLabel?.()}
            >
              Save
            </button>
          </div>
        ) : (
          <>
            <span className={`txr-cat ${!tx.label ? "none" : ""}`}>
              {tx.label ?? "Uncategorized"}
            </span>
            {tx.suggestion_status === "suggested" && tx.suggested_label ? (
              <span className="txr-flag">Suggested: {tx.suggested_label}</span>
            ) : null}
          </>
        )}
      </span>
      <span className={`txr-amt rtx-amt ta-r ${tx.direction === "in" ? "in" : "out"}`}>
        {formatSuMoney(Number(tx.amount), tx.direction)}
      </span>
      <span className="txr-status flex flex-col gap-1 items-start">
        {onPick ? (
          <span className="txr-pick mb-1" onClick={(e) => e.stopPropagation()}>
            <PickButton variant="row" pickable={rowPickable} onPick={onPick} />
          </span>
        ) : null}
        {txStatusChip(tx)}
        {tx.suggestion_status === "suggested" ? (
          <span className="txr-actions flex gap-2 flex-nowrap">
            <button
              type="button"
              className="btn btn-secondary text-xs shrink-0"
              onClick={() => onConfirm?.()}
            >
              Confirm
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs shrink-0"
              onClick={() => onReject?.()}
            >
              Reject
            </button>
          </span>
        ) : !tx.label ? (
          onStartEdit ? (
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => onStartEdit()}
            >
              Categorize
            </button>
          ) : null
        ) : onMakeRule ? (
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => onMakeRule()}
          >
            Make rule
          </button>
        ) : null}
      </span>
    </div>
  );
}
