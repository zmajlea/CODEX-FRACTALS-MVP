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

export type TxQuerySnap = {
  count: number;
  in: number;
  out: number;
  net: number;
  from?: string;
  to?: string;
  description: string;
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
      kind: Exclude<Evidence["kind"], "transaction">;
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

/** Map frozen txquery params → TxFilterInput for buildTxPredicate. */
export function txQueryParamsToFilters(
  params: Record<string, unknown>
): TxFilterInput {
  const status =
    typeof params.status === "string" ? (params.status as TxStatusFilter) : "all";
  const ruleQueue = params.ruleQueue;
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
  filters: TxFilterInput
): Promise<{ count: number; inflow: number; outflow: number; net: number }> {
  const rows = await fetchAllRows<{ amount: number; direction: string | null }>(
    (from, to) =>
      buildTxPredicate(
        admin
          .from("treasury_transactions")
          .select("amount, direction")
          .eq("client_user_id", clientUserId)
          .eq("is_removed", false)
          .order("posted_date", { ascending: false })
          .order("id", { ascending: false }),
        filters
      ).range(from, to)
  );

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
  agg: { count: number; net: number }
): string {
  const parts = [`${agg.count.toLocaleString()} transaction${agg.count === 1 ? "" : "s"}`];
  if (typeof params.q === "string" && params.q.trim()) {
    parts.push(params.q.trim());
  } else if (typeof params.description === "string" && params.description.trim()) {
    parts.push(params.description.trim());
  }
  parts.push(formatSignedNet(agg.net));
  return parts.join(" · ");
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

  return {
    kind: pickable.kind,
    id: newDraftId(),
    params: pickable.params,
  } as Evidence;
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
        const agg = await aggregateViaTxPredicate(admin, clientUserId, filters);
        const description = txQueryDescription(ev.params, agg);
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
      items.push({
        kind: "forecast",
        id: ev.id,
        available: true,
        label: asOf ? `Forecast as of ${asOf}` : "Forecast",
        sublabel: g,
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
        const agg = await aggregateViaTxPredicate(admin, clientUserId, filters);
        const snap: TxQuerySnap = {
          count: agg.count,
          in: agg.inflow,
          out: agg.outflow,
          net: agg.net,
          from: typeof ev.params.from === "string" ? ev.params.from : undefined,
          to: typeof ev.params.to === "string" ? ev.params.to : undefined,
          description: live.label,
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
