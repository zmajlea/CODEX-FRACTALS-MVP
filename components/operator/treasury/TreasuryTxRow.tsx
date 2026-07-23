"use client";

import { formatSuMoney, TREASURY_DISPLAY_LOCALE } from "@/lib/treasury/format";
import { CategoryPicker } from "@/components/operator/treasury/CategoryPicker";
import { PickButton } from "@/components/operator/treasury/PickButton";
import type { Pickable } from "@/lib/treasury/pickable";
import type {
  TreasuryTransactionRow,
  TreasuryTxSuggestion,
} from "@/lib/treasury/types";

export function txSourceDisplay(tx: TreasuryTransactionRow): string {
  const acct = tx.account;
  const id =
    tx.account_id?.replace(/^csv:/, "") ??
    acct?.mask ??
    acct?.name ??
    "—";
  const kind = acct?.institution_name ?? "CSV import";
  return `${id} ${kind}`;
}

function formatTxDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(TREASURY_DISPLAY_LOCALE, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));
  } catch {
    return iso;
  }
}

function pendingSuggestions(tx: TreasuryTransactionRow): TreasuryTxSuggestion[] {
  if (tx.suggestions && tx.suggestions.length > 0) return tx.suggestions;
  return [];
}

function isSuggestedRow(tx: TreasuryTransactionRow): boolean {
  if (tx.label) return false;
  if (tx.has_pending_suggestion) return true;
  return pendingSuggestions(tx).length > 0;
}

function anaStatusChip(tx: TreasuryTransactionRow) {
  if (isSuggestedRow(tx)) {
    return <span className="chip suggested">Suggested</span>;
  }
  if (tx.label) {
    return <span className="chip confirmed">Confirmed</span>;
  }
  return <span className="chip uncategorized">Uncategorized</span>;
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
  /** Spec 58 — confirm a specific rule's suggestion */
  onConfirmSuggestion?: (ruleId: string) => void;
  /** Spec 58 — reject a specific rule's suggestion */
  onRejectSuggestion?: (ruleId: string) => void;
  /**
   * @deprecated Spec 58 — prefer onConfirmSuggestion(ruleId).
   * Kept for call sites that already know the single rule (queue).
   */
  onConfirm?: () => void;
  /** @deprecated Spec 58 — prefer onRejectSuggestion(ruleId). */
  onReject?: () => void;
  onStartEdit?: () => void;
  onMakeRule?: () => void;
  onPick?: (
    draftKind: import("@/lib/treasury/pickable").DraftKind,
    pickable: Pickable
  ) => void;
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
  onConfirmSuggestion,
  onRejectSuggestion,
  onConfirm,
  onReject,
  onStartEdit,
  onMakeRule,
  onPick,
  highlighted = false,
}: Props) {
  const memo = tx.raw_name ?? tx.description ?? tx.merchant_name ?? tx.normalized_merchant ?? "—";
  const payee = tx.merchant_name ?? tx.normalized_merchant ?? memo;
  const rowPickable: Pickable = {
    kind: "transaction",
    ref: tx.id,
    label: payee,
    sublabel: tx.posted_date ?? undefined,
  };
  const suggestions = pendingSuggestions(tx);
  const isUncategorized = !tx.label && !isSuggestedRow(tx);
  const isSuggested = isSuggestedRow(tx);
  const isConfirmed = !!tx.label;

  return (
    <tr className={highlighted ? "focus-hit" : undefined} data-tx-id={tx.id}>
      {showSelect ? (
        <td>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select transaction ${tx.id}`}
            onChange={(e) => onToggleSelect?.(e.target.checked)}
          />
        </td>
      ) : null}
      <td>{formatTxDate(tx.posted_date)}</td>
      <td className="src">{txSourceDisplay(tx)}</td>
      <td className="memo">{memo}</td>
      <td>
        {editing ? (
          <div className="space-y-1 row-catpick">
            <CategoryPicker
              value={labelDraft}
              categories={labels}
              onChange={(v) => onLabelDraftChange?.(v)}
              placeholder="Category"
              aria-label="Category"
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-xs"
              rows={2}
              value={descDraft}
              onChange={(e) => onDescDraftChange?.(e.target.value)}
              placeholder="Description"
            />
            <button type="button" className="btn ghost text-xs" onClick={() => onSaveLabel?.()}>
              Save
            </button>
          </div>
        ) : isSuggested && suggestions.length > 0 ? (
          <div className="sug-stack" aria-label="Pending suggestions">
            {suggestions.map((s) => {
              const from =
                s.match_merchant?.trim() ||
                s.rule_name?.trim() ||
                "rule";
              return (
                <div key={s.rule_id} className="sug-chip">
                  <span className="chip suggested">
                    {s.suggested_label}
                    <span className="sug-from"> · from &ldquo;{from}&rdquo;</span>
                  </span>
                  {onConfirmSuggestion || onConfirm ? (
                    <button
                      type="button"
                      className="ra"
                      title={`Confirm ${s.suggested_label}`}
                      aria-label={`Confirm ${s.suggested_label}`}
                      onClick={() =>
                        onConfirmSuggestion
                          ? onConfirmSuggestion(s.rule_id)
                          : onConfirm?.()
                      }
                    >
                      ✓
                    </button>
                  ) : null}
                  {onRejectSuggestion || onReject ? (
                    <button
                      type="button"
                      className="ra"
                      title={`Reject ${s.suggested_label}`}
                      aria-label={`Reject ${s.suggested_label}`}
                      onClick={() =>
                        onRejectSuggestion
                          ? onRejectSuggestion(s.rule_id)
                          : onReject?.()
                      }
                    >
                      ✗
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span
            className={`cat-field${isUncategorized ? " empty" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onStartEdit?.()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStartEdit?.();
              }
            }}
          >
            {tx.label ?? "Add a category"}
          </span>
        )}
      </td>
      <td className="amtcell">
        <span className={`amt ${tx.direction === "in" ? "in" : "out"} num`}>
          {formatSuMoney(Number(tx.amount), tx.direction)}
        </span>
      </td>
      <td>{anaStatusChip(tx)}</td>
      <td className="row-act">
        <div className="row-act-in">
          {isUncategorized && onStartEdit ? (
            <button type="button" className="ra" onClick={() => onStartEdit()}>
              Categorize
            </button>
          ) : null}
          {isSuggested &&
          suggestions.length === 0 &&
          (onConfirmSuggestion || onConfirm) ? (
            <button
              type="button"
              className="ra"
              onClick={() => onConfirm?.()}
            >
              Confirm
            </button>
          ) : null}
          {isConfirmed && onMakeRule ? (
            <button type="button" className="ra" onClick={() => onMakeRule()}>
              + rule
            </button>
          ) : null}
          {onPick ? (
            <PickButton variant="row-draft" pickable={rowPickable} onPick={onPick} />
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** @deprecated Spec 46 — use ana chip classes on table rows. */
export function txStatusChip(tx: TreasuryTransactionRow) {
  return anaStatusChip(tx);
}

export function txSourceLabel(tx: TreasuryTransactionRow): string {
  return txSourceDisplay(tx);
}
