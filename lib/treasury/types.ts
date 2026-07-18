export type TreasurySource = "plaid" | "csv";

export type TreasuryTransaction = {
  date: string;
  name: string;
  amount: number;
  iso_currency_code: string | null;
  account_id: string;
  pending: boolean;
  direction?: "in" | "out" | null;
};

export type TreasuryAccountView = {
  account_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
};

export type TreasuryInstitutionView = {
  item_id: string;
  institution_name: string | null;
  institution_id?: string | null;
  needs_reconnect: boolean;
  key_destroyed?: boolean;
  accounts: TreasuryAccountView[];
};

export type TreasuryAccountsResponse = {
  institutions: TreasuryInstitutionView[];
  transactions: TreasuryTransaction[];
  last_synced_at: string | null;
  sync_triggered?: boolean;
  transaction_count?: number;
};

export type DateRangePreset =
  | "7d"
  | "30d"
  | "3m"
  | "12m"
  | "90d"
  | "ytd"
  | "all"
  | "custom";

/** All time = preset "all" with no from/to (no date filter on the API). */
export type TreasuryDateRange = {
  from?: string;
  to?: string;
  preset: DateRangePreset;
};

export type TreasuryBookStats = {
  count: number;
  first: string | null;
  last: string | null;
  importedAt: string | null;
};

export type TreasuryDrillRange = {
  from: string;
  to: string;
  label?: string;
};

/** Ingest adapter row before DB upsert. */
export type NormalizedTxRow = {
  external_id: string;
  plaid_item_id?: string | null;
  account_id: string;
  pending_external_id?: string | null;
  posted_date: string | null;
  authorized_date?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  raw_name?: string | null;
  merchant_name?: string | null;
  plaid_category?: string | null;
  pending?: boolean;
  is_removed?: boolean;
};

export type TreasuryTransactionRow = {
  id: string;
  client_user_id: string;
  source: TreasurySource;
  plaid_item_id: string | null;
  account_id: string;
  external_id: string;
  pending_external_id: string | null;
  posted_date: string | null;
  authorized_date: string | null;
  amount: number;
  direction: "in" | "out" | null;
  iso_currency_code: string | null;
  raw_name: string | null;
  merchant_name: string | null;
  normalized_merchant: string | null;
  plaid_category: string | null;
  pending: boolean;
  is_removed: boolean;
  label: string | null;
  description: string | null;
  label_source: "manual" | "rule_confirmed" | null;
  labeled_by: string | null;
  labeled_at: string | null;
  suggested_label: string | null;
  suggested_by_rule_id: string | null;
  suggestion_status: "suggested" | "confirmed" | "rejected" | null;
  suggestion_explanation: string | null;
  created_at: string;
  updated_at: string;
  account?: {
    name: string | null;
    mask: string | null;
    institution_name: string | null;
  };
};

export type SummaryBucket = "day" | "week" | "month" | "year";

export type TreasurySummaryRow = {
  period_start: string;
  iso_currency_code: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
};

export type SummaryGranularity = "day" | "week" | "month";

export type TreasurySummaryResponse = {
  granularity: SummaryGranularity;
  periods: number;
  from: string;
  to: string;
  primary_currency: string;
  rows: TreasurySummaryRow[];
  other_rows: TreasurySummaryRow[];
  data_span?: { first: string; last: string } | null;
};

export type TreasuryForecastRecurringLine = {
  merchant: string;
  direction: "in" | "out";
  amount: number;
  cadence: string;
};

export type TreasuryForecastPeriod = {
  period_start: string;
  recurring: TreasuryForecastRecurringLine[];
  baseline_inflow: number;
  baseline_outflow: number;
  projected_receipts: number;
  projected_disbursements: number;
  net: number;
  closing: number;
};

export type TreasuryForecastResponse = {
  granularity: SummaryGranularity;
  horizon: number;
  currency: string;
  seed_balance: number;
  as_of: string | null;
  baseline_periods: number;
  periods: TreasuryForecastPeriod[];
  excluded: {
    other_currencies: string[];
    pending_count: number;
    unlabeled_share_pct: number;
  };
  insufficient_history?: boolean;
  /** Seed window not fully inside dataSpan — refuse projection. */
  refuse_projection?: boolean;
  refuse_reason?: string;
  data_span?: { first: string; last: string } | null;
  history_days?: number;
};

export type TreasuryRuleRow = {
  id: string;
  client_user_id: string;
  created_by: string | null;
  name: string;
  match_merchant: string;
  match_type: "exact" | "contains" | "fuzzy";
  amount_min: number | null;
  amount_max: number | null;
  direction: "in" | "out" | null;
  cadence: string | null;
  assign_label: string;
  active: boolean;
  source_transaction_id: string | null;
  created_at: string;
  last_applied_at?: string | null;
  /** @deprecated Spec 36 — use suggested_count / confirmed_count */
  matched_count?: number;
  suggested_count?: number;
  confirmed_count?: number;
};

export type TreasuryRecommendationAnchorRef = {
  account_id: string;
  name: string | null;
  mask: string | null;
};

/** Spec 39 — what backs a recommendation. Wire transaction in R1; study/backtest R2. */
export type {
  Evidence as RecommendationEvidence,
  RecommendationTxSnap,
  ResolvedEvidenceItem,
} from "@/lib/treasury/evidence";
export type { DraftKind } from "@/lib/treasury/pickable";

export type TreasuryRecommendationRow = {
  id: string;
  client_user_id: string;
  operator_tenant_id: string | null;
  created_by: string | null;
  title: string;
  category: "liquidity" | "cost" | "financing" | "risk";
  why: string;
  impact_amount: number | null;
  impact_unit: string | null;
  impact_basis: "per_month" | "per_year" | "one_time" | null;
  anchor_type: "account" | "general";
  anchor_ref: TreasuryRecommendationAnchorRef | null;
  evidence: import("@/lib/treasury/evidence").Evidence[];
  /** Spec 40 — recommendation (judgment) vs question (request) */
  kind: "recommendation" | "question";
  status: "draft" | "sent" | "accepted" | "in_progress" | "done" | "declined";
  sealed_at: string | null;
  sealed_by: string | null;
  sent_at: string | null;
  decided_at: string | null;
  decline_reason: string | null;
  decline_note: string | null;
  /** Spec 40 §7 — client answer to a question */
  client_response: string | null;
  responded_at: string | null;
  operator_seen_at: string | null;
  client_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TreasuryRecommendationRollup = {
  awaiting: number;
  accepted: number;
  in_progress: number;
  done: number;
  declined: number;
  draft: number;
};

export type TreasuryInboxItem = {
  id: string;
  recommendationId: string;
  clientUserId: string;
  clientName: string;
  kind: "Accepted" | "Declined" | "Progress" | "Answered";
  title: string;
  sub: string | null;
  unread: boolean;
  actioned: boolean;
  updatedAt: string;
};

export type {
  SpendPlanResponse,
  SpendPlanMonthRow,
  SpendPlanBacktestRow,
  SpendPlanScenarioSummary,
  SpendPlanInput,
  SpendPlanScenario,
  SpendPlanHistoryResponse,
  InputProvenance,
} from "@/lib/treasury/spend-plan";
