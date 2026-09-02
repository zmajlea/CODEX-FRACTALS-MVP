/**
 * Spec B13 — rebuild migrated board→review snapshots with full exhibit envelopes.
 * Uses guarded RPC backfill_migrated_review_snapshot (immutability re-locks after each row).
 *
 * Prereq: migration 20260902140000_b13_operator_login_and_snapshot_backfill applied
 *
 * Usage: npm run backfill:migrated-reviews
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database, Json } from "../lib/database.types";
import {
  assembleAnalyticsBoard,
  sanitizeAssembledForClient,
  type AnalyticsBoardItem,
  type AnalyticsBoardRow,
} from "../lib/treasury/analytics-assemble";

type ReviewSnapshot = {
  meta: {
    title: string;
    period_month: string;
    reviewed_as_of: string;
    version: number;
    change_note: string;
  };
  cover_figures: unknown[];
  live_strip: { enabled: boolean; label?: string; note?: string };
  blocks: Array<Record<string, unknown>>;
  disclosures: { advisory: string; accuracy: string; review: string };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

type Admin = SupabaseClient<Database>;

type ReviewRow = {
  id: string;
  tenant_id: string;
  client_user_id: string;
  period_month: string;
  label: string;
  title: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type BlockRow = {
  role: string;
  metric_id: string | null;
  caption: string;
  body: string;
  position: number;
};

function loadEnvLocal() {
  const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function snapshotNeedsBackfill(snapshot: ReviewSnapshot | null): boolean {
  if (!snapshot?.blocks?.length) return false;
  return snapshot.blocks.some((b) => {
    const role = String(b.role ?? "");
    if (role !== "exhibit") return false;
    const computed = b.computed;
    const name = String(b.name ?? "");
    return computed == null || name === "Metric";
  });
}

async function rebuildMigratedSnapshot(
  admin: Admin,
  review: ReviewRow,
  blocks: BlockRow[],
  version: number,
  reviewedAsOf: string,
  changeNote: string,
  prior: ReviewSnapshot | null
): Promise<ReviewSnapshot> {
  const snapshotBlocks: Array<Record<string, unknown>> = [];

  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    if (block.role === "exhibit" && block.metric_id) {
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
    }
  }

  const disclosures =
    prior?.disclosures ??
    ({
      advisory:
        "This review is advisory. It does not constitute legal, tax, or investment advice.",
      accuracy:
        "Figures reflect your imported book as of the reviewed date. Live balances may differ.",
      review:
        "Published issues are frozen at the reviewed-as-of date. Republishing creates a new version.",
    } as ReviewSnapshot["disclosures"]);

  return {
    meta: {
      title: review.title,
      period_month: review.period_month,
      reviewed_as_of: reviewedAsOf,
      version,
      change_note: changeNote,
    },
    cover_figures: prior?.cover_figures ?? [],
    live_strip: prior?.live_strip ?? {
      enabled: false,
      label: "Cash position (live)",
      note: "Not part of the reviewed issue",
    },
    blocks: snapshotBlocks,
    disclosures,
  };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const admin = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

  const { data: migratedReviews, error: revErr } = await admin
    .from("treasury_reviews")
    .select("*")
    .like("label", "migrated:%");

  if (revErr) throw revErr;

  let updated = 0;
  let skipped = 0;

  for (const reviewRow of migratedReviews ?? []) {
    const review: ReviewRow = {
      id: String(reviewRow.id),
      tenant_id: String(reviewRow.tenant_id),
      client_user_id: String(reviewRow.client_user_id),
      period_month: String(reviewRow.period_month).slice(0, 10),
      label: String(reviewRow.label ?? ""),
      title: String(reviewRow.title ?? ""),
      status: String(reviewRow.status ?? ""),
      created_by: (reviewRow.created_by as string | null) ?? null,
      created_at: String(reviewRow.created_at ?? ""),
      updated_at: String(reviewRow.updated_at ?? ""),
    };

    const { data: versions, error: verErr } = await admin
      .from("treasury_review_versions")
      .select("id, review_id, version, snapshot, reviewed_as_of, change_note")
      .eq("review_id", review.id);

    if (verErr) throw verErr;

    for (const row of versions ?? []) {
      const snap = row.snapshot as unknown as ReviewSnapshot | null;
      if (!snapshotNeedsBackfill(snap)) {
        skipped += 1;
        continue;
      }

      const { data: blockRows } = await admin
        .from("treasury_review_blocks")
        .select("role, metric_id, caption, body, position")
        .eq("review_id", row.review_id)
        .order("position", { ascending: true });

      const blocks = (blockRows ?? []).map((b) => ({
        role: String(b.role),
        metric_id: (b.metric_id as string | null) ?? null,
        caption: String(b.caption ?? ""),
        body: String(b.body ?? ""),
        position: Number(b.position),
      }));

      const rebuilt = await rebuildMigratedSnapshot(
        admin,
        review,
        blocks,
        Number(row.version),
        String(row.reviewed_as_of ?? new Date().toISOString().slice(0, 10)),
        row.change_note ?? snap?.meta?.change_note ?? "Migrated from shared analytics board",
        snap
      );

      const { error: rpcErr } = await admin.rpc("backfill_migrated_review_snapshot", {
        p_version_id: row.id,
        p_snapshot: rebuilt as unknown as Json,
      });

      if (rpcErr) throw new Error(`${row.id}: ${rpcErr.message}`);
      updated += 1;
      console.log(`Backfilled version ${row.id} review ${row.review_id} v${row.version}`);
    }
  }

  console.log(`Done — updated ${updated}, skipped ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
