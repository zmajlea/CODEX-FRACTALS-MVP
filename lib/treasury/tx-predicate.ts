/**
 * Single Transactions WHERE assembly for the operator ledger.
 * Rows and every scoped count must go through applyTxPredicate / buildTxPredicate —
 * no second builder. Spec 36 names it buildTxPredicate; applyTxPredicate is the same function.
 *
 * Spec 58 ledger spine (has_pending_suggestion = trigger-maintained EXISTS):
 *   needs_label / uncategorised: label IS null AND has_pending_suggestion = false
 *   suggested:                   label IS null AND has_pending_suggestion = true
 *   labeled / confirmed:         label IS NOT null
 *
 * Rule-queue "suggested" for a specific rule is NOT expressed here alone — the list
 * route must constrain via treasury_transaction_suggestions.rule_id (!inner / in-ids).
 * Rule-queue "rejected" likewise uses treasury_rule_rejections in the list route.
 */

export type TxStatusFilter = "all" | "needs_label" | "suggested" | "labeled";

export type TxFilterInput = {
  from?: string | null;
  to?: string | null;
  status?: TxStatusFilter | string | null;
  /** Legacy labeled=true/false when status unset */
  labeled?: string | null;
  q?: string | null;
  accountIds?: string[];
  amountMin?: number | null;
  amountMax?: number | null;
  amountExact?: number | null;
  /** Spec 44 — rule companion / ledger direction filter */
  direction?: "in" | "out" | null;
  /** Rule queue: scope to this rule (list route joins suggestions/rejections) */
  ruleId?: string | null;
  /** When ruleId set: suggested | confirmed | rejected */
  ruleQueue?: "suggested" | "confirmed" | "rejected" | null;
};

export function escapeIlike(q: string): string {
  // Spec 55 D1 — escape `_` (single-char wildcard in ILIKE) so preview matches apply `.includes`
  return q.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&").replace(/,/g, "\\,");
}

type Filterable = {
  gte: (col: string, val: string) => Filterable;
  lte: (col: string, val: string) => Filterable;
  in: (col: string, vals: string[]) => Filterable;
  eq: (col: string, val: string | boolean) => Filterable;
  not: (col: string, op: string, val: null) => Filterable;
  is: (col: string, val: null) => Filterable;
  or: (expr: string) => Filterable;
};

/**
 * Apply the shared ledger predicate. Does not set client_user_id / is_removed /
 * order / limit / cursor — those stay on the route.
 */
export function applyTxPredicate<Q extends Filterable>(query: Q, filters: TxFilterInput): Q {
  let q: Filterable = query;

  if (filters.from) q = q.gte("posted_date", filters.from);
  if (filters.to) q = q.lte("posted_date", filters.to);
  if (filters.accountIds?.length) q = q.in("account_id", filters.accountIds);
  if (filters.direction === "in" || filters.direction === "out") {
    q = q.eq("direction", filters.direction);
  }

  if (filters.ruleId && filters.ruleQueue) {
    if (filters.ruleQueue === "suggested") {
      // Base: pending suggestions exist. List route further scopes to ruleId.
      q = q.is("label", null).eq("has_pending_suggestion", true);
    } else if (filters.ruleQueue === "confirmed") {
      q = q
        .eq("suggested_by_rule_id", filters.ruleId)
        .eq("label_source", "rule_confirmed");
    } else if (filters.ruleQueue === "rejected") {
      // List route replaces this with rejection-table id filter; keep empty-safe base.
      q = q.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  } else {
    const status = filters.status ?? undefined;
    if (status === "suggested") {
      q = q.is("label", null).eq("has_pending_suggestion", true);
    } else if (status === "labeled") {
      q = q.not("label", "is", null);
    } else if (status === "needs_label") {
      q = q.is("label", null).eq("has_pending_suggestion", false);
    } else if (!status || status === "all") {
      if (filters.labeled === "true") q = q.not("label", "is", null);
      if (filters.labeled === "false") q = q.is("label", null);
    }
  }

  if (filters.q) {
    const safe = escapeIlike(filters.q);
    q = q.or(
      `normalized_merchant.ilike.%${safe}%,raw_name.ilike.%${safe}%,merchant_name.ilike.%${safe}%,description.ilike.%${safe}%`
    );
  }

  if (filters.amountExact != null && Number.isFinite(filters.amountExact)) {
    const x = Math.abs(filters.amountExact);
    q = q.or(`amount.eq.${x},amount.eq.${-x}`);
  } else if (
    (filters.amountMin != null && Number.isFinite(filters.amountMin)) ||
    (filters.amountMax != null && Number.isFinite(filters.amountMax))
  ) {
    const min = Number(filters.amountMin ?? filters.amountMax);
    const max = Number(filters.amountMax ?? filters.amountMin);
    const lo = Math.min(Math.abs(min), Math.abs(max));
    const hi = Math.max(Math.abs(min), Math.abs(max));
    q = q.or(
      `and(amount.gte.${lo},amount.lte.${hi}),and(amount.gte.${-hi},amount.lte.${-lo})`
    );
  }

  return q as Q;
}

/** Spec 36 name — identical to applyTxPredicate. Prefer this at call sites that cite the contract. */
export const buildTxPredicate = applyTxPredicate;

/** Chip counts: same filters with only the status dimension swapped. */
export function withStatus(
  filters: TxFilterInput,
  status: TxStatusFilter
): TxFilterInput {
  return { ...filters, status, ruleId: null, ruleQueue: null };
}
