/**
 * Spec 40 — destination-agnostic evidence.
 * No server-only. No lib/server imports. No recommendation-module coupling.
 *
 * Batch A resolvers: txquery uses buildTxPredicate (spec 36) — never a second WHERE builder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { fetchAllRows } from "@/lib/treasury/fetch-all-rows";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  FORECAST_BOUNDARY_CAVEAT,
  FORECAST_ENGINE_LABEL,
} from "@/lib/treasury/forecast-disclosure";
import {
  assertAbsolutePickParams,
  type Pickable,
} from "@/lib/treasury/pickable";
import {
  buildTxPredicate,
  type TxFilterInput,
  type TxStatusFilter,
} from "@/lib/treasury/tx-predicate";

type AdminClient = SupabaseClient<Database>;

export type RecommendationTxSnap = {
  date: string;
  payee: string | null;
  amount: number;
  category: string | null;
  direction: "in" | "out" | null;
};

export type TxQuerySnapRow = {
  date: string;
  payee: string | null;
  amount: number;
  direction: "in" | "out" | null;
};

export type TxQuerySnap = {
  count: number;
  in: number;
  out: number;
  net: number;
  from?: string;
  to?: string;
  description: string;
  /** Spec 45 — present only when params.limit is bounded (1–25). */
  rows?: TxQuerySnapRow[];
};

export type SummaryPeriodSnap = {
  granularity: string;
  from: string;
  to: string;
  accountId?: string;
  in: number;
  out: number;
  net: number;
  count: number;
};

export type ProjectedFigureSnap = {
  label?: string;
  sublabel?: string;
  amount?: number;
  direction?: "in" | "out" | null;
  projected?: boolean;
  caveat?: string;
  engineLabel?: string;
  startMonth?: string;
  /** Spec 50 — account the projected figure is scoped to. */
  accountName?: string;
};

/** Reference + recipe union. Recipe `id` is a draft-local key for remove, not a row ref. */
export type Evidence =
  | { kind: "transaction"; id: string; snap?: RecommendationTxSnap }
  | { kind: "study"; id: string; snap?: unknown }
  | {
      kind: "backtest";
      id?: string;
      params: Record<string, unknown>;
      snap?: unknown;
    }
  | { kind: "rule"; id: string; snap?: unknown }
  | { kind: "account"; id: string; snap?: unknown }
  | { kind: "import"; id: string; snap?: unknown }
  | { kind: "recommendation"; id: string; snap?: unknown }
  | {
      kind: "txquery";
      id?: string;
      params: Record<string, unknown>;
      snap?: TxQuerySnap;
    }
  | {
      kind: "summary_period";
      id?: string;
      params: Record<string, unknown>;
      snap?: SummaryPeriodSnap;
    }
  | {
      kind: "summary_range";
      id?: string;
      params: Record<string, unknown>;
      snap?: unknown;
    }
  | { kind: "month"; id?: string; params: Record<string, unknown>; snap?: unknown }
  | {
      kind: "scenario";
      id?: string;
      params: Record<string, unknown>;
      snap?: unknown;
    }
  | {
      kind: "forecast";
      id?: string;
      params: Record<string, unknown>;
      snap?: unknown;
    }
  | {
      kind: "figure";
      id?: string;
      params: Record<string, unknown>;
      snap?: unknown;
    };

/** @deprecated Spec 39 name — prefer Evidence */
export type RecommendationEvidence = Evidence;

export type ResolvedEvidenceItem =
  | {
      kind: "transaction";
      id: string;
      available: true;
      date: string;
      payee: string | null;
      amount: number;
      category: string | null;
      direction: "in" | "out" | null;
      raw_name: string | null;
      label: string;
      sublabel?: string;
    }
  | {
      kind: "transaction";
      id: string;
      available: false;
      label: string;
    }
  | {
      kind: "txquery";
      id?: string;
      available: true;
      label: string;
      sublabel?: string;
      amount?: number;
      direction?: "in" | "out" | null;
      /** Spec 45 — live rows when bounded (draft preview). */
      rows?: TxQuerySnapRow[];
    }
  | {
      kind: "txquery";
      id?: string;
      available: false;
      label: string;
    }
  | {
      kind: Exclude<Evidence["kind"], "transaction" | "txquery">;
      id?: string;
      available: boolean;
      label: string;
      sublabel?: string;
      amount?: number;
      direction?: "in" | "out" | null;
    };

function payeeFromRow(row: {
  merchant_name: string | null;
  normalized_merchant: string | null;
  raw_name: string | null;
}): string | null {
  return row.merchant_name ?? row.normalized_merchant ?? row.raw_name ?? null;
}

function newDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatSignedNet(net: number): string {
  const abs = formatTreasuryMoney(Math.abs(net), "USD");
  if (net > 0) return `+${abs}`;
  if (net < 0) return `\u2212${abs}`;
  return abs;
}

/** Spec 44 — question companion “recent N like this rule”. */
export const RULE_CONTEXT_DEFAULT_N = 5;
export const RULE_CONTEXT_MIN_N = 1;
export const RULE_CONTEXT_MAX_N = 25;

export type RuleLikeForContext = {
  id: string;
  match_merchant: string;
  amount_min: number | null;
  amount_max: number | null;
  direction: "in" | "out" | null;
};

/** Clamp N to 1–25; null if not a valid integer in range. */
export function clampRuleContextN(n: unknown): number | null {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x) || !Number.isInteger(x)) return null;
  if (x < RULE_CONTEXT_MIN_N || x > RULE_CONTEXT_MAX_N) return null;
  return x;
}

/** Client-facing label — ilike-q, not the rule engine’s exact matcher. */
export function ruleContextLabel(n: number): string {
  return `Recent ${n} transactions like this rule — for context.`;
}

export function isRuleContextCompanion(ev: Evidence): boolean {
  return (
    ev.kind === "txquery" &&
    typeof ev.params.contextForRuleId === "string" &&
    ev.params.contextForRuleId.length > 0
  );
}

export function hasRuleContextCompanion(
  evidence: Evidence[],
  ruleId: string
): boolean {
  return evidence.some(
    (ev) =>
      ev.kind === "txquery" && ev.params.contextForRuleId === ruleId
  );
}

/** N from an existing companion, else default 5. */
export function currentRuleContextN(evidence: Evidence[]): number {
  for (const ev of evidence) {
    if (!isRuleContextCompanion(ev) || ev.kind !== "txquery") continue;
    const lim = clampRuleContextN(ev.params.limit);
    if (lim != null) return lim;
  }
  return RULE_CONTEXT_DEFAULT_N;
}

export function buildRuleContextTxQueryParams(
  rule: RuleLikeForContext,
  n: number
): Record<string, unknown> {
  const limit = clampRuleContextN(n) ?? RULE_CONTEXT_DEFAULT_N;
  const params: Record<string, unknown> = {
    q: rule.match_merchant,
    limit,
    contextForRuleId: rule.id,
  };
  if (rule.amount_min != null && Number.isFinite(rule.amount_min)) {
    params.amountMin = rule.amount_min;
  }
  if (rule.amount_max != null && Number.isFinite(rule.amount_max)) {
    params.amountMax = rule.amount_max;
  }
  if (rule.direction === "in" || rule.direction === "out") {
    params.direction = rule.direction;
  }
  assertAbsolutePickParams(params);
  return params;
}

/** Replace every Spec-44 companion’s limit (and rebuild params when rule known). */
export function replaceRuleContextCompanions(
  evidence: Evidence[],
  n: number,
  rulesById: Map<string, RuleLikeForContext>
): Evidence[] {
  const limit = clampRuleContextN(n);
  if (limit == null) {
    throw new Error("N must be an integer from 1 to 25");
  }
  return evidence.map((ev) => {
    if (ev.kind !== "txquery" || !isRuleContextCompanion(ev)) return ev;
    const ruleId = String(ev.params.contextForRuleId);
    const rule = rulesById.get(ruleId);
    if (rule) {
      return {
        ...ev,
        params: buildRuleContextTxQueryParams(rule, limit),
        snap: undefined,
      };
    }
    return {
      ...ev,
      params: { ...ev.params, limit },
      snap: undefined,
    };
  });
}

function txQueryLimitFromParams(
  params: Record<string, unknown>
): number | undefined {
  const lim = clampRuleContextN(params.limit);
  if (lim != null) return lim;
  if (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
    return Math.floor(params.limit);
  }
  return undefined;
}

/** Spec 45 — freeze rows only when limit is 1–25. */
export function isBoundedTxQueryLimit(
  limit: number | undefined
): limit is number {
  return (
    limit != null &&
    Number.isInteger(limit) &&
    limit >= RULE_CONTEXT_MIN_N &&
    limit <= RULE_CONTEXT_MAX_N
  );
}

function aggregateFromSnapRows(rows: TxQuerySnapRow[]): {
  count: number;
  inflow: number;
  outflow: number;
  net: number;
} {
  let inflow = 0;
  let outflow = 0;
  for (const row of rows) {
    const amt = Math.abs(Number(row.amount) || 0);
    if (row.direction === "in") inflow += amt;
    else if (row.direction === "out") outflow += amt;
  }
  return {
    count: rows.length,
    inflow,
    outflow,
    net: inflow - outflow,
  };
}

/** Spec 45 — bounded txquery rows via buildTxPredicate (same WHERE as aggregate). */
export async function fetchBoundedTxQueryRows(
  admin: AdminClient,
  clientUserId: string,
  filters: TxFilterInput,
  limit: number
): Promise<TxQuerySnapRow[]> {
  const capped = Math.min(
    Math.max(Math.floor(limit), RULE_CONTEXT_MIN_N),
    RULE_CONTEXT_MAX_N
  );
  const { data, error } = await buildTxPredicate(
    admin
      .from("treasury_transactions")
      .select(
        "posted_date, merchant_name, normalized_merchant, raw_name, amount, direction"
      )
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .order("posted_date", { ascending: false })
      .order("id", { ascending: false }),
    filters
  ).range(0, capped - 1);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const direction =
      row.direction === "in" || row.direction === "out" ? row.direction : null;
    return {
      date: String(row.posted_date ?? "").slice(0, 10),
      payee: payeeFromRow(row),
      amount: Math.abs(Number(row.amount) || 0),
      direction,
    };
  });
}

/** Map frozen txquery params → TxFilterInput for buildTxPredicate. */
export function txQueryParamsToFilters(
  params: Record<string, unknown>
): TxFilterInput {
  const status =
    typeof params.status === "string" ? (params.status as TxStatusFilter) : "all";
  const ruleQueue = params.ruleQueue;
  const direction =
    params.direction === "in" || params.direction === "out"
      ? params.direction
      : undefined;
  return {
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
    status,
    q: typeof params.q === "string" && params.q ? params.q : undefined,
    accountIds: Array.isArray(params.accountIds)
      ? (params.accountIds.filter((x): x is string => typeof x === "string") as string[])
      : undefined,
    amountMin: typeof params.amountMin === "number" ? params.amountMin : null,
    amountMax: typeof params.amountMax === "number" ? params.amountMax : null,
    amountExact: typeof params.amountExact === "number" ? params.amountExact : null,
    direction,
    ruleId: typeof params.ruleId === "string" ? params.ruleId : undefined,
    ruleQueue:
      ruleQueue === "suggested" ||
      ruleQueue === "confirmed" ||
      ruleQueue === "rejected"
        ? ruleQueue
        : undefined,
  };
}

async function aggregateViaTxPredicate(
  admin: AdminClient,
  clientUserId: string,
  filters: TxFilterInput,
  opts?: { limit?: number }
): Promise<{ count: number; inflow: number; outflow: number; net: number }> {
  const base = () =>
    buildTxPredicate(
      admin
        .from("treasury_transactions")
        .select("amount, direction")
        .eq("client_user_id", clientUserId)
        .eq("is_removed", false)
        .order("posted_date", { ascending: false })
        .order("id", { ascending: false }),
      filters
    );

  let rows: { amount: number; direction: string | null }[];
  const limit = opts?.limit;
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    const { data, error } = await base().range(0, Math.floor(limit) - 1);
    if (error) throw error;
    rows = (data ?? []) as { amount: number; direction: string | null }[];
  } else {
    rows = await fetchAllRows<{ amount: number; direction: string | null }>(
      (from, to) => base().range(from, to)
    );
  }

  let inflow = 0;
  let outflow = 0;
  for (const row of rows) {
    const amt = Math.abs(Number(row.amount) || 0);
    if (row.direction === "in") inflow += amt;
    else if (row.direction === "out") outflow += amt;
  }
  return {
    count: rows.length,
    inflow,
    outflow,
    net: inflow - outflow,
  };
}

function txQueryDescription(
  params: Record<string, unknown>,
  agg: { count: number; net: number },
  opts?: { bounded?: boolean }
): string {
  if (
    typeof params.contextForRuleId === "string" &&
    params.contextForRuleId.length > 0
  ) {
    const n =
      clampRuleContextN(params.limit) ??
      (agg.count > 0 ? agg.count : RULE_CONTEXT_DEFAULT_N);
    return ruleContextLabel(n);
  }
  const parts = [`${agg.count.toLocaleString()} transaction${agg.count === 1 ? "" : "s"}`];
  if (typeof params.q === "string" && params.q.trim()) {
    parts.push(params.q.trim());
  } else if (typeof params.description === "string" && params.description.trim()) {
    parts.push(params.description.trim());
  }
  parts.push(formatSignedNet(agg.net));
  let label = parts.join(" · ");
  // Spec 45 — unbounded views are aggregate-only; say so honestly
  if (!opts?.bounded && !/summary only/i.test(label)) {
    label = `${label} · summary only`;
  }
  return label;
}

export function parseEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  const out: Evidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    if (typeof kind !== "string") continue;

    if (
      kind === "transaction" ||
      kind === "study" ||
      kind === "rule" ||
      kind === "account" ||
      kind === "import" ||
      kind === "recommendation"
    ) {
      const id = typeof rec.id === "string" ? rec.id : null;
      if (!id) continue;
      out.push({
        kind,
        id,
        ...(rec.snap !== undefined ? { snap: rec.snap as never } : {}),
      } as Evidence);
      continue;
    }

    if (
      kind === "txquery" ||
      kind === "summary_period" ||
      kind === "summary_range" ||
      kind === "month" ||
      kind === "scenario" ||
      kind === "forecast" ||
      kind === "figure" ||
      kind === "backtest"
    ) {
      const params =
        rec.params && typeof rec.params === "object"
          ? (rec.params as Record<string, unknown>)
          : undefined;
      if (!params) continue;
      const id = typeof rec.id === "string" ? rec.id : undefined;
      out.push({
        kind,
        params,
        ...(id ? { id } : {}),
        ...(rec.snap !== undefined ? { snap: rec.snap as never } : {}),
      } as Evidence);
    }
  }
  return out;
}

export function evidenceAsJson(evidence: Evidence[]): Json {
  return evidence as unknown as Json;
}

/** Convert a Pickable into one Evidence item (never N rows for a recipe). */
export function evidenceFromPickable(pickable: Pickable): Evidence {
  assertAbsolutePickParams(pickable.params);

  const refKinds = new Set([
    "transaction",
    "study",
    "rule",
    "account",
    "import",
    "recommendation",
  ]);

  if (refKinds.has(pickable.kind)) {
    const id = pickable.ref?.trim();
    if (!id) {
      throw new Error(`Pickable ${pickable.kind} requires ref`);
    }
    if (pickable.snap && pickable.kind === "import") {
      return { kind: "import", id, snap: pickable.snap } as Evidence;
    }
    return { kind: pickable.kind, id } as Evidence;
  }

  if (!pickable.params || Object.keys(pickable.params).length === 0) {
    throw new Error(`Pickable ${pickable.kind} requires absolute params`);
  }

  const recipe: Evidence = {
    kind: pickable.kind,
    id: newDraftId(),
    params: pickable.params,
  } as Evidence;

  if (pickable.snap && Object.keys(pickable.snap).length > 0) {
    return { ...recipe, snap: pickable.snap as never };
  }

  return recipe;
}

export function appendTransactionEvidence(
  evidence: Evidence[],
  transactionIds: string[]
): Evidence[] {
  return tryAppendTransactionEvidence(evidence, transactionIds).evidence;
}

export function tryAppendTransactionEvidence(
  evidence: Evidence[],
  transactionIds: string[]
): { evidence: Evidence[]; added: number; duplicate: boolean } {
  const seen = new Set(
    evidence.filter((e) => e.kind === "transaction").map((e) => ("id" in e ? e.id : ""))
  );
  const next = [...evidence];
  let added = 0;
  for (const id of transactionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({ kind: "transaction", id });
    added += 1;
  }
  return {
    evidence: next,
    added,
    duplicate: added === 0 && transactionIds.length > 0,
  };
}

function evidenceIdentityKey(item: Evidence): string {
  if (item.kind === "transaction") return `transaction:${item.id}`;
  if ("id" in item && item.id) return `${item.kind}:${item.id}`;
  if ("params" in item && item.params) {
    try {
      return `${item.kind}:${JSON.stringify(item.params)}`;
    } catch {
      return `${item.kind}:params`;
    }
  }
  return item.kind;
}

export function appendEvidenceItem(
  evidence: Evidence[],
  item: Evidence
): Evidence[] {
  return tryAppendEvidenceItem(evidence, item).evidence;
}

/** Stage 8b-3 — skip duplicates; report whether anything was added. */
export function tryAppendEvidenceItem(
  evidence: Evidence[],
  item: Evidence
): { evidence: Evidence[]; duplicate: boolean } {
  if (item.kind === "transaction") {
    return tryAppendTransactionEvidence(evidence, [item.id]);
  }
  const key = evidenceIdentityKey(item);
  const exists = evidence.some((e) => evidenceIdentityKey(e) === key);
  if (exists) {
    return { evidence, duplicate: true };
  }
  return { evidence: [...evidence, item], duplicate: false };
}

export function removeEvidenceItem(
  evidence: Evidence[],
  kind: string,
  id: string
): Evidence[] {
  return evidence.filter((e) => {
    const eid = "id" in e ? e.id : undefined;
    if (!eid) return true;
    return !(e.kind === kind && eid === id);
  });
}

export async function resolveEvidenceLive(
  admin: AdminClient,
  clientUserId: string,
  evidence: Evidence[]
): Promise<{ items: ResolvedEvidenceItem[]; missingCount: number }> {
  const txIds = evidence
    .filter((e): e is Extract<Evidence, { kind: "transaction" }> => e.kind === "transaction")
    .map((e) => e.id);

  const studyIds = evidence
    .filter((e): e is Extract<Evidence, { kind: "study" }> => e.kind === "study")
    .map((e) => e.id);

  const byId = new Map<
    string,
    {
      posted_date: string | null;
      authorized_date: string | null;
      amount: number;
      direction: string | null;
      merchant_name: string | null;
      normalized_merchant: string | null;
      raw_name: string | null;
      label: string | null;
    }
  >();

  if (txIds.length > 0) {
    const { data } = await admin
      .from("treasury_transactions")
      .select(
        "id, posted_date, authorized_date, amount, direction, merchant_name, normalized_merchant, raw_name, label"
      )
      .eq("client_user_id", clientUserId)
      .eq("is_removed", false)
      .in("id", txIds);

    for (const row of data ?? []) {
      byId.set(row.id, row);
    }
  }

  const studiesById = new Map<string, { id: string; name: string }>();
  if (studyIds.length > 0) {
    const { data } = await admin
      .from("treasury_studies")
      .select("id, name")
      .eq("client_user_id", clientUserId)
      .in("id", studyIds);
    for (const row of data ?? []) {
      studiesById.set(row.id, row);
    }
  }

  const items: ResolvedEvidenceItem[] = [];
  let missingCount = 0;

  for (const ev of evidence) {
    if (ev.kind === "transaction") {
      const row = byId.get(ev.id);
      if (!row) {
        missingCount += 1;
        items.push({
          kind: "transaction",
          id: ev.id,
          available: false,
          label: "Item no longer available",
        });
        continue;
      }
      const date = row.posted_date ?? row.authorized_date ?? "";
      const direction =
        row.direction === "in" || row.direction === "out" ? row.direction : null;
      const payee = payeeFromRow(row);
      items.push({
        kind: "transaction",
        id: ev.id,
        available: true,
        date,
        payee,
        amount: Number(row.amount),
        category: row.label,
        direction,
        raw_name: row.raw_name,
        label: payee || "—",
        sublabel: date,
      });
      continue;
    }

    if (ev.kind === "txquery") {
      try {
        const filters = txQueryParamsToFilters(ev.params);
        const limit = txQueryLimitFromParams(ev.params);
        const bounded = isBoundedTxQueryLimit(limit);
        let agg: { count: number; inflow: number; outflow: number; net: number };
        let rows: TxQuerySnapRow[] | undefined;
        if (bounded) {
          rows = await fetchBoundedTxQueryRows(
            admin,
            clientUserId,
            filters,
            limit
          );
          agg = aggregateFromSnapRows(rows);
        } else {
          agg = await aggregateViaTxPredicate(admin, clientUserId, filters);
        }
        const description = txQueryDescription(ev.params, agg, { bounded });
        items.push({
          kind: "txquery",
          id: ev.id,
          available: true,
          label: description,
          sublabel:
            [ev.params.from, ev.params.to].filter(Boolean).join(" → ") ||
            undefined,
          amount: Math.abs(agg.net),
          direction: agg.net > 0 ? "in" : agg.net < 0 ? "out" : null,
          ...(rows ? { rows } : {}),
        });
      } catch {
        missingCount += 1;
        items.push({
          kind: "txquery",
          id: ev.id,
          available: false,
          label: "Filtered view unavailable",
        });
      }
      continue;
    }

    if (ev.kind === "summary_period") {
      const from = typeof ev.params.from === "string" ? ev.params.from : null;
      const to = typeof ev.params.to === "string" ? ev.params.to : null;
      if (!from || !to) {
        missingCount += 1;
        items.push({
          kind: "summary_period",
          id: ev.id,
          available: false,
          label: "Period unavailable",
        });
        continue;
      }
      try {
        const accountId =
          typeof ev.params.accountId === "string" ? ev.params.accountId : undefined;
        const filters: TxFilterInput = {
          from,
          to,
          accountIds: accountId ? [accountId] : undefined,
          status: "all",
        };
        const agg = await aggregateViaTxPredicate(admin, clientUserId, filters);
        const g =
          typeof ev.params.granularity === "string" ? ev.params.granularity : "period";
        items.push({
          kind: "summary_period",
          id: ev.id,
          available: true,
          label: `${g} ${from} → ${to} · ${formatSignedNet(agg.net)}`,
          sublabel: `${agg.count} tx`,
          amount: Math.abs(agg.net),
          direction: agg.net > 0 ? "in" : agg.net < 0 ? "out" : null,
        });
      } catch {
        missingCount += 1;
        items.push({
          kind: "summary_period",
          id: ev.id,
          available: false,
          label: "Period unavailable",
        });
      }
      continue;
    }

    if (ev.kind === "study") {
      const row = studiesById.get(ev.id);
      if (!row) {
        missingCount += 1;
        items.push({
          kind: "study",
          id: ev.id,
          available: false,
          label: "Study no longer available",
        });
        continue;
      }
      items.push({
        kind: "study",
        id: ev.id,
        available: true,
        label: row.name || "Untitled spend plan",
        sublabel: "study",
      });
      continue;
    }

    if (ev.kind === "backtest") {
      const startMonth =
        typeof ev.params.startMonth === "string"
          ? ev.params.startMonth
          : typeof ev.params.backtestStartMonth === "string"
            ? ev.params.backtestStartMonth
            : null;
      const studyId =
        typeof ev.params.studyId === "string" ? ev.params.studyId : undefined;
      if (studyId) {
        const { data: study } = await admin
          .from("treasury_studies")
          .select("id, name")
          .eq("client_user_id", clientUserId)
          .eq("id", studyId)
          .maybeSingle();
        if (!study) {
          missingCount += 1;
          items.push({
            kind: "backtest",
            id: ev.id,
            available: false,
            label: "Backtest study unavailable",
          });
          continue;
        }
      }
      const base = ev.params.base;
      const step = ev.params.step;
      items.push({
        kind: "backtest",
        id: ev.id,
        available: true,
        label: startMonth
          ? `Backtest from ${startMonth.slice(0, 7)}`
          : "Backtest",
        sublabel:
          typeof base === "number" && typeof step === "number"
            ? `base ${base} · step ${step}`
            : undefined,
      });
      continue;
    }

    if (ev.kind === "summary_range") {
      const from = typeof ev.params.from === "string" ? ev.params.from : null;
      const to = typeof ev.params.to === "string" ? ev.params.to : null;
      if (!from || !to) {
        missingCount += 1;
        items.push({
          kind: "summary_range",
          id: ev.id,
          available: false,
          label: "Range unavailable",
        });
        continue;
      }
      try {
        const accountId =
          typeof ev.params.accountId === "string" ? ev.params.accountId : undefined;
        const agg = await aggregateViaTxPredicate(admin, clientUserId, {
          from,
          to,
          accountIds: accountId ? [accountId] : undefined,
          status: "all",
        });
        const g =
          typeof ev.params.granularity === "string" ? ev.params.granularity : "range";
        items.push({
          kind: "summary_range",
          id: ev.id,
          available: true,
          label: `${g} ${from} → ${to} · ${formatSignedNet(agg.net)}`,
          sublabel: `${agg.count} tx`,
          amount: Math.abs(agg.net),
          direction: agg.net > 0 ? "in" : agg.net < 0 ? "out" : null,
        });
      } catch {
        missingCount += 1;
        items.push({
          kind: "summary_range",
          id: ev.id,
          available: false,
          label: "Range unavailable",
        });
      }
      continue;
    }

    if (ev.kind === "rule") {
      const { data: rule } = await admin
        .from("treasury_rules")
        .select("id, name, match_merchant, assign_label, active")
        .eq("client_user_id", clientUserId)
        .eq("id", ev.id)
        .maybeSingle();
      if (!rule) {
        missingCount += 1;
        items.push({
          kind: "rule",
          id: ev.id,
          available: false,
          label: "Rule no longer available",
        });
        continue;
      }
      items.push({
        kind: "rule",
        id: ev.id,
        available: true,
        label: `"${rule.match_merchant}" → ${rule.assign_label}`,
        sublabel: rule.active ? "active" : "paused",
      });
      continue;
    }

    if (ev.kind === "account") {
      const { data: acct } = await admin
        .from("treasury_accounts")
        .select("account_id, name, mask, current_balance, iso_currency_code")
        .eq("client_user_id", clientUserId)
        .eq("account_id", ev.id)
        .maybeSingle();
      if (!acct) {
        missingCount += 1;
        items.push({
          kind: "account",
          id: ev.id,
          available: false,
          label: "Account no longer available",
        });
        continue;
      }
      const name = acct.name ?? acct.account_id;
      const mask = acct.mask ? ` · ${acct.mask}` : "";
      items.push({
        kind: "account",
        id: ev.id,
        available: true,
        label: `${name}${mask}`,
        sublabel:
          acct.current_balance != null
            ? formatTreasuryMoney(Number(acct.current_balance), acct.iso_currency_code)
            : undefined,
      });
      continue;
    }

    if (ev.kind === "month") {
      const month =
        typeof ev.params.month === "string" ? ev.params.month.slice(0, 7) : null;
      if (!month) {
        missingCount += 1;
        items.push({
          kind: "month",
          id: ev.id,
          available: false,
          label: "Month unavailable",
        });
        continue;
      }
      const from = `${month}-01`;
      const d = new Date(`${from}T12:00:00Z`);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      const to = last.toISOString().slice(0, 10);
      const accountId =
        typeof ev.params.accountId === "string" ? ev.params.accountId : undefined;
      try {
        const agg = await aggregateViaTxPredicate(admin, clientUserId, {
          from,
          to,
          accountIds: accountId ? [accountId] : undefined,
          status: "all",
        });
        items.push({
          kind: "month",
          id: ev.id,
          available: true,
          label: `Month ${month} · ${formatSignedNet(agg.net)}`,
          sublabel: `${agg.count} tx · out ${formatTreasuryMoney(agg.outflow, "USD")}`,
          amount: Math.abs(agg.net),
          direction: agg.net > 0 ? "in" : agg.net < 0 ? "out" : null,
        });
      } catch {
        missingCount += 1;
        items.push({
          kind: "month",
          id: ev.id,
          available: false,
          label: "Month unavailable",
        });
      }
      continue;
    }

    if (ev.kind === "scenario") {
      const studyId =
        typeof ev.params.studyId === "string" ? ev.params.studyId : null;
      const scenarioId =
        typeof ev.params.scenarioId === "string" ? ev.params.scenarioId : null;
      if (!studyId || !scenarioId) {
        missingCount += 1;
        items.push({
          kind: "scenario",
          id: ev.id,
          available: false,
          label: "Scenario unavailable",
        });
        continue;
      }
      const { data: study } = await admin
        .from("treasury_studies")
        .select("id, name, scenarios")
        .eq("client_user_id", clientUserId)
        .eq("id", studyId)
        .maybeSingle();
      if (!study) {
        missingCount += 1;
        items.push({
          kind: "scenario",
          id: ev.id,
          available: false,
          label: "Scenario study unavailable",
        });
        continue;
      }
      const scenarios = (study.scenarios ?? []) as {
        id: string;
        name: string;
        growthPct?: number;
      }[];
      const sc = scenarios.find((s) => s.id === scenarioId);
      items.push({
        kind: "scenario",
        id: ev.id,
        available: true,
        label: sc?.name ?? scenarioId,
        sublabel: study.name ? `in ${study.name}` : undefined,
      });
      continue;
    }

    if (ev.kind === "forecast") {
      const asOf =
        typeof ev.params.asOf === "string"
          ? ev.params.asOf
          : typeof ev.params.to === "string"
            ? ev.params.to
            : null;
      const g =
        typeof ev.params.granularity === "string" ? ev.params.granularity : "month";
      const preSnap = ev.snap as ProjectedFigureSnap | undefined;
      const accountName =
        preSnap?.accountName ??
        (typeof ev.params.accountName === "string"
          ? ev.params.accountName
          : typeof ev.params.accountId === "string"
            ? ev.params.accountId
            : undefined);
      const baseLabel =
        preSnap?.label ?? (asOf ? `Forecast as of ${asOf}` : "Forecast");
      items.push({
        kind: "forecast",
        id: ev.id,
        available: true,
        label:
          accountName && !baseLabel.includes(accountName)
            ? `${baseLabel} · ${accountName}`
            : baseLabel,
        sublabel: preSnap?.sublabel ?? g,
        amount: preSnap?.amount,
        direction: preSnap?.direction,
      });
      continue;
    }

    if (ev.kind === "figure") {
      const metric =
        typeof ev.params.metric === "string" ? ev.params.metric : "figure";
      const from = typeof ev.params.from === "string" ? ev.params.from : undefined;
      const to = typeof ev.params.to === "string" ? ev.params.to : undefined;
      items.push({
        kind: "figure",
        id: ev.id,
        available: true,
        label: metric.replace(/_/g, " "),
        sublabel: [from, to].filter(Boolean).join(" → ") || undefined,
      });
      continue;
    }

    if (ev.kind === "import") {
      // Prefer frozen snap (reconcile report at pick); else CSV source stub.
      if (ev.snap && typeof ev.snap === "object" && "label" in (ev.snap as object)) {
        const snap = ev.snap as { label?: string; sublabel?: string };
        items.push({
          kind: "import",
          id: ev.id,
          available: true,
          label: snap.label ?? "Import",
          sublabel: snap.sublabel,
        });
        continue;
      }
      const { data: item } = await admin
        .from("plaid_items")
        .select("id, institution_name, plaid_item_id")
        .eq("client_user_id", clientUserId)
        .or(`id.eq.${ev.id},plaid_item_id.eq.${ev.id}`)
        .maybeSingle();
      if (!item && ev.id !== "csv-manual") {
        missingCount += 1;
        items.push({
          kind: "import",
          id: ev.id,
          available: false,
          label: "Import no longer available",
        });
        continue;
      }
      items.push({
        kind: "import",
        id: ev.id,
        available: true,
        label: item?.institution_name ?? "CSV import",
        sublabel:
          item?.plaid_item_id === "csv-manual" || ev.id === "csv-manual"
            ? "csv"
            : "bank",
      });
      continue;
    }

    if (ev.kind === "recommendation") {
      const { data: rec } = await admin
        .from("treasury_recommendations")
        .select("id, title, status, sealed_at, kind")
        .eq("client_user_id", clientUserId)
        .eq("id", ev.id)
        .maybeSingle();
      if (!rec || !rec.sealed_at) {
        missingCount += 1;
        items.push({
          kind: "recommendation",
          id: ev.id,
          available: false,
          label: "Sealed recommendation unavailable",
        });
        continue;
      }
      items.push({
        kind: "recommendation",
        id: ev.id,
        available: true,
        label: rec.title || "Recommendation",
        sublabel: `sealed · ${rec.status}`,
      });
      continue;
    }

    // All Evidence kinds are handled above; keep a runtime fallback for stale stored rows.
    missingCount += 1;
    const stale = ev as { kind: string; id?: string };
    items.push({
      kind: (stale.kind as Exclude<Evidence["kind"], "transaction">) || "txquery",
      id: stale.id,
      available: false,
      label: `${stale.kind} (resolver pending)`,
    });
  }

  return { items, missingCount };
}

export async function snapshotEvidence(
  admin: AdminClient,
  clientUserId: string,
  evidence: Evidence[]
): Promise<Evidence[]> {
  const { items } = await resolveEvidenceLive(admin, clientUserId, evidence);

  return Promise.all(
    evidence.map(async (ev, idx) => {
      const live = items[idx];
      if (ev.kind === "transaction") {
        if (!live || live.kind !== "transaction" || !live.available) {
          return { kind: "transaction" as const, id: ev.id };
        }
        const snap: RecommendationTxSnap = {
          date: live.date,
          payee: live.payee,
          amount: live.amount,
          category: live.category,
          direction: live.direction,
        };
        return { kind: "transaction" as const, id: ev.id, snap };
      }

      if (ev.kind === "txquery" && live?.available && live.kind === "txquery") {
        const filters = txQueryParamsToFilters(ev.params);
        const limit = txQueryLimitFromParams(ev.params);
        const bounded = isBoundedTxQueryLimit(limit);
        let agg: { count: number; inflow: number; outflow: number; net: number };
        let rows: TxQuerySnapRow[] | undefined;
        if (bounded) {
          rows =
            "rows" in live && Array.isArray(live.rows) && live.rows.length
              ? live.rows
              : await fetchBoundedTxQueryRows(
                  admin,
                  clientUserId,
                  filters,
                  limit
                );
          agg = aggregateFromSnapRows(rows);
        } else {
          agg = await aggregateViaTxPredicate(admin, clientUserId, filters);
        }
        const description =
          live.label ||
          txQueryDescription(ev.params, agg, { bounded });
        const snap: TxQuerySnap = {
          count: agg.count,
          in: agg.inflow,
          out: agg.outflow,
          net: agg.net,
          from: typeof ev.params.from === "string" ? ev.params.from : undefined,
          to: typeof ev.params.to === "string" ? ev.params.to : undefined,
          description,
          ...(rows ? { rows } : {}),
        };
        return { ...ev, snap };
      }

      if (
        ev.kind === "summary_period" &&
        live?.available &&
        live.kind === "summary_period"
      ) {
        const from = String(ev.params.from);
        const to = String(ev.params.to);
        const accountId =
          typeof ev.params.accountId === "string" ? ev.params.accountId : undefined;
        const agg = await aggregateViaTxPredicate(admin, clientUserId, {
          from,
          to,
          accountIds: accountId ? [accountId] : undefined,
          status: "all",
        });
        const snap: SummaryPeriodSnap = {
          granularity: String(ev.params.granularity ?? "month"),
          from,
          to,
          accountId,
          in: agg.inflow,
          out: agg.outflow,
          net: agg.net,
          count: agg.count,
        };
        return { ...ev, snap };
      }

      if (ev.kind === "forecast") {
        const pre = (ev.snap ?? {}) as ProjectedFigureSnap;
        const liveItem =
          live?.available && live.kind === "forecast" ? live : null;
        const projected = ev.params.projected === true || pre.projected === true;
        const snap: ProjectedFigureSnap = {
          label: pre.label ?? liveItem?.label ?? "Forecast",
          sublabel: pre.sublabel ?? liveItem?.sublabel,
          amount: pre.amount ?? liveItem?.amount,
          direction: pre.direction ?? liveItem?.direction,
          projected,
          caveat: pre.caveat ?? (projected ? FORECAST_BOUNDARY_CAVEAT : undefined),
          engineLabel:
            pre.engineLabel ??
            (projected ? FORECAST_ENGINE_LABEL : undefined),
          accountName:
            pre.accountName ??
            (typeof ev.params.accountName === "string"
              ? ev.params.accountName
              : typeof ev.params.accountId === "string"
                ? ev.params.accountId
                : undefined),
        };
        return { ...ev, snap };
      }

      if (ev.kind === "backtest" && ev.snap && typeof ev.snap === "object") {
        return ev;
      }

      if (live?.available) {
        return {
          ...ev,
          snap: {
            label: live.label,
            sublabel: live.sublabel,
            amount: live.amount,
            direction: live.direction,
          },
        } as Evidence;
      }
      return ev;
    })
  );
}

/** @deprecated Spec 39 name */
export const snapshotEvidenceAtSeal = snapshotEvidence;

export async function assertTransactionsBelongToClient(
  admin: AdminClient,
  clientUserId: string,
  transactionIds: string[]
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  if (transactionIds.length === 0) return { ok: true };
  const unique = [...new Set(transactionIds)];
  const { data } = await admin
    .from("treasury_transactions")
    .select("id")
    .eq("client_user_id", clientUserId)
    .eq("is_removed", false)
    .in("id", unique);

  const found = new Set((data ?? []).map((r) => r.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

export function evidenceRunningTotal(
  items: ResolvedEvidenceItem[]
): { direction: "in" | "out"; total: number } | null {
  const available = items.filter(
    (i) =>
      i.available &&
      i.kind === "transaction" &&
      "direction" in i &&
      (i.direction === "in" || i.direction === "out")
  ) as Extract<ResolvedEvidenceItem, { available: true; kind: "transaction" }>[];
  if (available.length === 0) return null;
  const dirs = new Set(available.map((i) => i.direction));
  if (dirs.size !== 1) return null;
  const direction = [...dirs][0];
  if (direction !== "in" && direction !== "out") return null;
  const total = available.reduce((sum, i) => sum + Math.abs(i.amount), 0);
  return { direction, total };
}
