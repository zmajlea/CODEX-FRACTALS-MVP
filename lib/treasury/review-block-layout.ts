/**
 * Spec B17 M1 — layout helpers for the Issue canvas.
 * layout is presentation-only; never triggers metric recompute.
 */

export type ReviewBlockLayout = { w: number; h: number };

export const LAYOUT_PRESETS = [
  { id: "S", label: "S", w: 3, h: 1 },
  { id: "M", label: "M", w: 6, h: 1 },
  { id: "L", label: "L", w: 9, h: 1 },
  { id: "Full", label: "Full", w: 12, h: 1 },
] as const;

/** null / invalid → full-width legacy (12×1). */
export function resolveLayout(raw: unknown): ReviewBlockLayout {
  if (!raw || typeof raw !== "object") return { w: 12, h: 1 };
  const o = raw as { w?: unknown; h?: unknown };
  const w = Math.round(Number(o.w));
  const h = Math.round(Number(o.h));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { w: 12, h: 1 };
  return {
    w: Math.min(12, Math.max(1, w)),
    h: Math.min(3, Math.max(1, h)),
  };
}

export function parseLayoutOrNull(raw: unknown): ReviewBlockLayout | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const o = raw as { w?: unknown; h?: unknown };
  const w = Math.round(Number(o.w));
  const h = Math.round(Number(o.h));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < 1 || w > 12 || h < 1 || h > 3) return null;
  return { w, h };
}

/**
 * True when placed_snapshot carries a chartable series from cache
 * (analytics points or comparison envelope). Value-kind snapshots do not.
 */
export function snapshotHasSeries(snap: unknown): boolean {
  if (!snap || typeof snap !== "object") return false;
  const s = snap as {
    kind?: string;
    series?: { points?: unknown[] };
    comparison?: { v?: number; points?: unknown[] };
  };
  if (s.kind === "value") return false;
  if (s.kind === "analytics") {
    return Array.isArray(s.series?.points) && s.series.points.length > 0;
  }
  if (s.kind === "comparison") {
    return s.comparison != null && typeof s.comparison === "object";
  }
  // Legacy / untyped: points present counts as series
  if (Array.isArray(s.series?.points) && s.series.points.length > 0) return true;
  if (s.comparison != null && typeof s.comparison === "object") return true;
  return false;
}

/**
 * Chart vs number-tile from cached envelope + width.
 * Value-only → always tile (never chart, never recompute).
 * Series present → w≤3 tile, w≥6 chart (mid prefers chart).
 */
export function renderMetricAsChart(
  layout: ReviewBlockLayout,
  snap: unknown
): boolean {
  if (!snapshotHasSeries(snap)) return false;
  return layout.w >= 6;
}

export function gridColumnSpan(
  layout: ReviewBlockLayout,
  bp: "desktop" | "tablet" | "phone"
): number {
  if (bp === "phone") return 1;
  if (bp === "tablet") {
    // 2-col grid: Full/L → span 2, S/M → span 1
    return layout.w >= 9 ? 2 : 1;
  }
  return layout.w;
}
