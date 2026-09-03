import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  computeMetricValue,
  findMetricForClient,
  type ComputeMetricResult,
  type MetricComparison,
  type MetricSeries,
} from "@/lib/treasury/metrics-eval";

type Admin = SupabaseClient<Database>;

export type AnalyticsBoardItem = {
  metric_id: string;
  note?: string;
};

export type AnalyticsBoardRow = {
  id: string;
  tenant_id: string;
  client_user_id: string;
  title: string;
  description: string;
  items: AnalyticsBoardItem[];
  status: string;
  shared_at: string | null;
  shared_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssembledMetricItem = {
  metric_id: string;
  note?: string;
  missing?: boolean;
  metric?: {
    id: string;
    name: string;
    description: string;
    kind: string;
    definition: Json;
    computed_at: string | null;
  };
  computed?: {
    kind: "value" | "analytics" | "comparison";
    value?: number;
    series?: MetricSeries;
    comparison?: MetricComparison;
    computed_at: string;
  };
};

export type AssembledBoard = {
  board: AnalyticsBoardRow;
  items: AssembledMetricItem[];
  as_of: string;
};

function parseItems(raw: unknown): AnalyticsBoardItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const metric_id = typeof o.metric_id === "string" ? o.metric_id : null;
      if (!metric_id) return null;
      const note = typeof o.note === "string" ? o.note : undefined;
      return { metric_id, ...(note ? { note } : {}) };
    })
    .filter((x): x is AnalyticsBoardItem => !!x);
}

export function normalizeBoardRow(
  row: Record<string, unknown>
): AnalyticsBoardRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    client_user_id: String(row.client_user_id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    items: parseItems(row.items),
    status: String(row.status ?? "draft"),
    shared_at: (row.shared_at as string | null) ?? null,
    shared_by: (row.shared_by as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function toComputedPayload(out: ComputeMetricResult): AssembledMetricItem["computed"] {
  if (out.kind === "value") {
    return {
      kind: "value",
      value: out.value,
      computed_at: out.computed_at,
    };
  }
  if (out.kind === "comparison") {
    return {
      kind: "comparison",
      value: out.value,
      comparison: out.comparison,
      computed_at: out.computed_at,
    };
  }
  return {
    kind: "analytics",
    value: out.value,
    series: out.series,
    computed_at: out.computed_at,
  };
}

/**
 * Spec B7 — one assemble path for operator Open, client portal, and PDF.
 * Caller must already authorize access to the board row.
 */
export async function assembleAnalyticsBoard(
  admin: Admin,
  board: AnalyticsBoardRow
): Promise<AssembledBoard> {
  const items: AssembledMetricItem[] = [];

  for (const item of board.items) {
    const metric = await findMetricForClient(
      admin,
      board.tenant_id,
      board.client_user_id,
      item.metric_id
    );
    if (!metric) {
      items.push({
        metric_id: item.metric_id,
        note: item.note,
        missing: true,
      });
      continue;
    }

    try {
      const out = await computeMetricValue(admin, {
        id: metric.id,
        tenant_id: metric.tenant_id,
        client_user_id: metric.client_user_id ?? board.client_user_id,
        definition: metric.definition as Json,
      });
      items.push({
        metric_id: item.metric_id,
        note: item.note,
        metric: {
          id: metric.id,
          name: metric.name,
          description: metric.description,
          kind: metric.kind ?? "value",
          definition: metric.definition as Json,
          computed_at: metric.computed_at,
        },
        computed: toComputedPayload(out),
      });
    } catch {
      items.push({
        metric_id: item.metric_id,
        note: item.note,
        metric: {
          id: metric.id,
          name: metric.name,
          description: metric.description,
          kind: metric.kind ?? "value",
          definition: metric.definition as Json,
          computed_at: metric.computed_at,
        },
        missing: true,
      });
    }
  }

  return {
    board,
    items,
    as_of: new Date().toISOString().slice(0, 10),
  };
}

/** Client-facing payload: envelopes only — never ledger rows. */
export function sanitizeAssembledForClient(assembled: AssembledBoard) {
  return {
    board: {
      id: assembled.board.id,
      title: assembled.board.title,
      description: assembled.board.description,
      shared_at: assembled.board.shared_at,
      status: assembled.board.status,
    },
    as_of: assembled.as_of,
    items: assembled.items.map((it) => ({
      metric_id: it.metric_id,
      note: it.note,
      missing: it.missing ?? false,
      name: it.metric?.name ?? "Unavailable metric",
      description: it.metric?.description ?? "",
      kind: it.metric?.kind ?? "value",
      computed: it.computed
        ? {
            kind: it.computed.kind,
            value: it.computed.value,
            series: it.computed.series
              ? {
                  v: it.computed.series.v,
                  unit: it.computed.series.unit,
                  subdivision: it.computed.series.subdivision,
                  window: it.computed.series.window,
                  points: it.computed.series.points,
                  reference_lines: it.computed.series.reference_lines,
                  summary: it.computed.series.summary,
                  chart_hint: it.computed.series.chart_hint,
                }
              : undefined,
            comparison: it.computed.comparison
              ? {
                  v: it.computed.comparison.v,
                  kind: it.computed.comparison.kind,
                  unit: it.computed.comparison.unit,
                  subdivision: it.computed.comparison.subdivision,
                  axis: it.computed.comparison.axis,
                  groups: it.computed.comparison.groups,
                  reference_lines: it.computed.comparison.reference_lines,
                  summary: it.computed.comparison.summary,
                  chart_hint: it.computed.comparison.chart_hint,
                }
              : undefined,
            computed_at: it.computed.computed_at,
          }
        : null,
    })),
    disclosures: {
      advisory:
        "Advisory only. This dashboard summarizes curated metrics from your book; it is not investment, tax, or legal advice.",
      accuracy:
        "Figures reflect your ledger as of the last import / sync shown below.",
      review: "Reviewed and shared by your Summit operator.",
    },
  };
}
