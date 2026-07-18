/**
 * Spec 40 — destination-agnostic evidence.
 * No server-only. No lib/server imports. No recommendation-module coupling.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type AdminClient = SupabaseClient<Database>;

export type RecommendationTxSnap = {
  date: string;
  payee: string | null;
  amount: number;
  category: string | null;
  direction: "in" | "out" | null;
};

/** Reference + recipe union — Stage 1 resolves transaction; others defined for day-2. */
export type Evidence =
  | { kind: "transaction"; id: string; snap?: RecommendationTxSnap }
  | { kind: "study"; id: string; snap?: unknown }
  | { kind: "backtest"; id: string; params?: Record<string, unknown>; snap?: unknown }
  | { kind: "rule"; id: string; snap?: unknown }
  | { kind: "account"; id: string; snap?: unknown }
  | { kind: "import"; id: string; snap?: unknown }
  | { kind: "recommendation"; id: string; snap?: unknown }
  | { kind: "txquery"; params: Record<string, unknown>; snap?: unknown }
  | { kind: "summary_period"; params: Record<string, unknown>; snap?: unknown }
  | { kind: "summary_range"; params: Record<string, unknown>; snap?: unknown }
  | { kind: "month"; params: Record<string, unknown>; snap?: unknown }
  | { kind: "scenario"; params: Record<string, unknown>; snap?: unknown }
  | { kind: "forecast"; params: Record<string, unknown>; snap?: unknown }
  | { kind: "figure"; params: Record<string, unknown>; snap?: unknown };

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

export function parseEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  const out: Evidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    if (typeof kind !== "string") continue;

    if (kind === "transaction" || kind === "study" || kind === "rule" || kind === "account" || kind === "import" || kind === "recommendation") {
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
      if (kind === "backtest" && typeof rec.id === "string") {
        out.push({
          kind: "backtest",
          id: rec.id,
          ...(params ? { params } : {}),
          ...(rec.snap !== undefined ? { snap: rec.snap } : {}),
        });
      } else if (params) {
        out.push({
          kind,
          params,
          ...(rec.snap !== undefined ? { snap: rec.snap } : {}),
        } as Evidence);
      }
    }
  }
  return out;
}

export function evidenceAsJson(evidence: Evidence[]): Json {
  return evidence as unknown as Json;
}

export function appendTransactionEvidence(
  evidence: Evidence[],
  transactionIds: string[]
): Evidence[] {
  const seen = new Set(
    evidence.filter((e) => e.kind === "transaction").map((e) => ("id" in e ? e.id : ""))
  );
  const next = [...evidence];
  for (const id of transactionIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({ kind: "transaction", id });
  }
  return next;
}

export function removeEvidenceItem(
  evidence: Evidence[],
  kind: string,
  id: string
): Evidence[] {
  return evidence.filter((e) => {
    if (!("id" in e) || !e.id) return true;
    return !(e.kind === kind && e.id === id);
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

    // Stage 1: other kinds render as opaque live stubs (Batch A+ wires resolvers).
    missingCount += 1;
    items.push({
      kind: ev.kind,
      id: "id" in ev ? ev.id : undefined,
      available: false,
      label: `${ev.kind} (resolver pending)`,
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
  const liveById = new Map(
    items
      .filter((i) => i.kind === "transaction" && i.available && "id" in i)
      .map((i) => [i.id!, i] as const)
  );

  return evidence.map((ev) => {
    if (ev.kind !== "transaction") return ev;
    const live = liveById.get(ev.id);
    if (!live || !live.available || live.kind !== "transaction") {
      return { kind: "transaction" as const, id: ev.id };
    }
    const snap: RecommendationTxSnap = {
      date: live.date,
      payee: live.payee,
      amount: live.amount,
      category: live.category,
      direction: live.direction,
    };
    return { kind: "transaction", id: ev.id, snap };
  });
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
