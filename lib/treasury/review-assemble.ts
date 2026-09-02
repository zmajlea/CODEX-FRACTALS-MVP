import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  assembleAnalyticsBoard,
  sanitizeAssembledForClient,
  type AnalyticsBoardItem,
  type AnalyticsBoardRow,
} from "@/lib/treasury/analytics-assemble";
import {
  computeMetricValue,
  findMetricForClient,
  type ComputeMetricResult,
} from "@/lib/treasury/metrics-eval";
import { autoCaption, autoCaptionComparison, autoCaptionValue } from "@/lib/treasury/auto-caption";
import { normalizeRecommendationRow } from "@/lib/server/treasury-recommendation-evidence";

type Admin = SupabaseClient<Database>;

export type ReviewBlockRow = {
  id: string;
  review_id: string;
  position: number;
  role: "figure" | "exhibit" | "note" | "narrative";
  metric_id: string | null;
  recommendation_id: string | null;
  pinned_window: Json | null;
  placed_snapshot: Json | null;
  caption: string;
  body: string;
  proposal_state: string;
  provenance: Json;
  created_at: string;
  updated_at: string;
};

export type ReviewRow = {
  id: string;
  tenant_id: string;
  client_user_id: string;
  period_month: string;
  label: string;
  title: string;
  status: string;
  current_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewSnapshot = {
  meta: {
    title: string;
    period_month: string;
    reviewed_as_of: string;
    version: number;
    change_note: string;
  };
  cover_figures: Array<{
    label: string;
    value: number | string;
    unit: string;
    flag: "none" | "warn";
    caption: string;
  }>;
  live_strip: { enabled: boolean; label?: string; note?: string };
  blocks: Array<Record<string, unknown>>;
  disclosures: {
    advisory: string;
    accuracy: string;
    review: string;
  };
};

export function normalizeReviewRow(row: Record<string, unknown>): ReviewRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    client_user_id: String(row.client_user_id),
    period_month: String(row.period_month).slice(0, 10),
    label: String(row.label ?? ""),
    title: String(row.title ?? ""),
    status: String(row.status ?? "draft"),
    current_version: Number(row.current_version ?? 0),
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export function normalizeBlockRow(row: Record<string, unknown>): ReviewBlockRow {
  return {
    id: String(row.id),
    review_id: String(row.review_id),
    position: Number(row.position),
    role: row.role as ReviewBlockRow["role"],
    metric_id: (row.metric_id as string | null) ?? null,
    recommendation_id: (row.recommendation_id as string | null) ?? null,
    pinned_window: (row.pinned_window as Json | null) ?? null,
    placed_snapshot: (row.placed_snapshot as Json | null) ?? null,
    caption: String(row.caption ?? ""),
    body: String(row.body ?? ""),
    proposal_state: String(row.proposal_state ?? "none"),
    provenance: (row.provenance as Json) ?? {},
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function toPlacedSnapshot(out: ComputeMetricResult): Json {
  if (out.kind === "value") {
    return { kind: "value", value: out.value, computed_at: out.computed_at };
  }
  if (out.kind === "comparison") {
    return {
      kind: "comparison",
      value: out.value,
      comparison: out.comparison as unknown as Json,
      computed_at: out.computed_at,
    };
  }
  return {
    kind: "analytics",
    value: out.value,
    series: out.series as unknown as Json,
    computed_at: out.computed_at,
  };
}

function snapshotValueDiff(
  placed: Json | null,
  current: ComputeMetricResult
): boolean {
  if (!placed || typeof placed !== "object") return true;
  const p = placed as Record<string, unknown>;
  if (current.kind === "value") {
    return p.kind !== "value" || p.value !== current.value;
  }
  if (current.kind === "comparison") {
    if (p.kind !== "comparison") return true;
    const pc = p.comparison as { summary?: { value?: number } } | undefined;
    const cs = current.comparison?.summary?.value ?? current.value;
    return pc?.summary?.value !== cs && p.value !== current.value;
  }
  if (p.kind !== "analytics") return true;
  const ps = p.series as { summary?: { value?: number } } | undefined;
  const cs = current.series?.summary?.value ?? current.value;
  return ps?.summary?.value !== cs && p.value !== current.value;
}

/** Compute fresh metric output for a block. */
export async function computeBlockMetric(
  admin: Admin,
  tenantId: string,
  clientUserId: string,
  block: ReviewBlockRow
): Promise<ComputeMetricResult | null> {
  if (!block.metric_id) return null;
  const metric = await findMetricForClient(
    admin,
    tenantId,
    clientUserId,
    block.metric_id
  );
  if (!metric) return null;
  return computeMetricValue(admin, {
    id: metric.id,
    tenant_id: metric.tenant_id,
    client_user_id: metric.client_user_id ?? clientUserId,
    definition: metric.definition as Json,
  });
}

export async function isBlockStale(
  admin: Admin,
  tenantId: string,
  clientUserId: string,
  block: ReviewBlockRow
): Promise<boolean> {
  if (block.role !== "figure" && block.role !== "exhibit") return false;
  const current = await computeBlockMetric(admin, tenantId, clientUserId, block);
  if (!current) return true;
  return snapshotValueDiff(block.placed_snapshot, current);
}

/** Adapt review blocks into board shape for assemble/sanitize. */
export async function assembleExhibitFromBlocks(
  admin: Admin,
  review: ReviewRow,
  blocks: ReviewBlockRow[]
): Promise<ReturnType<typeof sanitizeAssembledForClient>> {
  const exhibitBlocks = blocks.filter((b) => b.role === "exhibit" && b.metric_id);
  const items: AnalyticsBoardItem[] = exhibitBlocks.map((b) => ({
    metric_id: b.metric_id!,
    note: b.caption || undefined,
  }));

  const board: AnalyticsBoardRow = {
    id: review.id,
    tenant_id: review.tenant_id,
    client_user_id: review.client_user_id,
    title: review.title,
    description: "",
    items,
    status: review.status,
    shared_at: null,
    shared_by: null,
    created_by: review.created_by,
    created_at: review.created_at,
    updated_at: review.updated_at,
  };

  const assembled = await assembleAnalyticsBoard(admin, board);
  return sanitizeAssembledForClient(assembled);
}

export async function buildReviewSnapshot(
  admin: Admin,
  review: ReviewRow,
  blocks: ReviewBlockRow[],
  version: number,
  changeNote: string,
  reviewedAsOf: string
): Promise<ReviewSnapshot> {
  const sorted = [...blocks].sort((a, b) => a.position - b.position);
  const coverFigures: ReviewSnapshot["cover_figures"] = [];
  const snapshotBlocks: Array<Record<string, unknown>> = [];

  for (const block of sorted) {
    if (block.role === "figure" && block.metric_id) {
      const out = await computeBlockMetric(
        admin,
        review.tenant_id,
        review.client_user_id,
        block
      );
      const metric = await findMetricForClient(
        admin,
        review.tenant_id,
        review.client_user_id,
        block.metric_id
      );
      const label = metric?.name ?? "Figure";
      const value = out?.kind === "value" ? out.value : (out?.value ?? 0);
      const unit = metric?.definition
        ? ((metric.definition as { unit?: string }).unit ?? "usd")
        : "usd";
      coverFigures.push({
        label,
        value,
        unit,
        flag: "none",
        caption: block.caption,
      });
      snapshotBlocks.push({
        role: "figure",
        label,
        value,
        unit,
        caption: block.caption,
      });
    } else if (block.role === "exhibit" && block.metric_id) {
      const items: AnalyticsBoardItem[] = [
        { metric_id: block.metric_id, note: block.caption || undefined },
      ];
      const board: AnalyticsBoardRow = {
        id: review.id,
        tenant_id: review.tenant_id,
        client_user_id: review.client_user_id,
        title: review.title,
        description: "",
        items,
        status: "draft",
        shared_at: null,
        shared_by: null,
        created_by: review.created_by,
        created_at: review.created_at,
        updated_at: review.updated_at,
      };
      const assembled = await assembleAnalyticsBoard(admin, board);
      const sanitized = sanitizeAssembledForClient(assembled);
      const item = sanitized.items[0];
      snapshotBlocks.push({
        role: "exhibit",
        name: item?.name ?? "Exhibit",
        caption: block.caption,
        computed: item?.computed ?? null,
      });
    } else if (block.role === "note") {
      snapshotBlocks.push({
        role: "note",
        title: block.caption || "",
        body: block.body,
      });
    } else if (block.role === "narrative" && block.recommendation_id) {
      const { data: rec } = await admin
        .from("treasury_recommendations")
        .select("*")
        .eq("id", block.recommendation_id)
        .maybeSingle();
      if (rec) {
        const row = normalizeRecommendationRow(rec as Record<string, unknown>);
        snapshotBlocks.push({
          role: "narrative",
          recommendation_id: block.recommendation_id,
          kind: row.kind,
          title: row.title,
          body: row.why,
          impact:
            row.impact_amount != null
              ? {
                  amount: row.impact_amount,
                  unit: row.impact_unit,
                  basis: row.impact_basis,
                }
              : undefined,
        });
      }
    }
  }

  const sanitized = await assembleExhibitFromBlocks(admin, review, blocks);

  return {
    meta: {
      title: review.title,
      period_month: review.period_month,
      reviewed_as_of: reviewedAsOf,
      version,
      change_note: changeNote,
    },
    cover_figures: coverFigures.slice(0, 4),
    live_strip: { enabled: false, label: "Cash position (live)", note: "Not part of the reviewed issue" },
    blocks: snapshotBlocks,
    disclosures: sanitized.disclosures,
  };
}

export function diffSnapshotChangeNote(
  prior: ReviewSnapshot | null,
  next: ReviewSnapshot
): string {
  if (!prior) return "Initial published issue.";
  const priorIds = new Set(
    prior.blocks
      .filter((b) => b.role === "narrative")
      .map((b) => String(b.recommendation_id ?? ""))
  );
  const added = next.blocks.filter(
    (b) => b.role === "narrative" && !priorIds.has(String(b.recommendation_id ?? ""))
  );
  if (added.length) return `${added.length} new narrative block(s) since v${prior.meta.version}.`;
  return `Updated figures and exhibits for v${next.meta.version}.`;
}

export async function suggestedCaptionForBlock(
  admin: Admin,
  tenantId: string,
  clientUserId: string,
  block: ReviewBlockRow
): Promise<string> {
  const out = await computeBlockMetric(admin, tenantId, clientUserId, block);
  if (!out) return "";
  if (out.kind === "analytics" && out.series) return autoCaption(out.series);
  if (out.kind === "comparison" && out.comparison) {
    return autoCaptionComparison(out.comparison);
  }
  if (out.kind === "value") return autoCaptionValue(out.value, "usd");
  return "";
}

export { snapshotValueDiff, toPlacedSnapshot };
