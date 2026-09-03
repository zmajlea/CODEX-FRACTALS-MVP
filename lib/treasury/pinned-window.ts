/**
 * Spec B15 — per-block pinned window presets.
 * Deterministic year mapping for series_compare by:"year":
 *   this_vs_last / last_2_years → [Y-1, Y]
 *   custom range → every calendar year the range spans
 */
import type { MetricDefinition, MetricWindow } from "@/lib/mcp/metrics-schema";

export type PinnedWindowPreset =
  | "ytd"
  | "trailing_12"
  | "last_2_years"
  | "this_vs_last"
  | "custom";

export type PinnedWindow =
  | { preset: "ytd" }
  | { preset: "trailing_12" }
  | { preset: "last_2_years" }
  | { preset: "this_vs_last" }
  | { preset: "custom"; start: string; end: string };

export function isPinnedWindow(raw: unknown): raw is PinnedWindow {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  const preset = o.preset;
  if (preset === "ytd" || preset === "trailing_12" || preset === "last_2_years" || preset === "this_vs_last") {
    return true;
  }
  if (preset === "custom") {
    return (
      typeof o.start === "string" &&
      typeof o.end === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.start) &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.end)
    );
  }
  return false;
}

/** Years for by:"year" comparison — deterministic per review note. */
export function yearsFromPinnedWindow(
  pinned: PinnedWindow,
  now = new Date()
): number[] {
  const y = now.getUTCFullYear();
  if (pinned.preset === "this_vs_last" || pinned.preset === "last_2_years") {
    return [y - 1, y];
  }
  if (pinned.preset === "ytd" || pinned.preset === "trailing_12") {
    return [y];
  }
  const startY = Number(pinned.start.slice(0, 4));
  const endY = Number(pinned.end.slice(0, 4));
  if (!Number.isFinite(startY) || !Number.isFinite(endY) || endY < startY) {
    return [y];
  }
  const years: number[] = [];
  for (let yr = startY; yr <= endY; yr += 1) years.push(yr);
  return years;
}

/** Map a pinned preset to a MetricWindow for value/analytics (non year-compare). */
export function pinnedToMetricWindow(
  pinned: PinnedWindow,
  now = new Date()
): MetricWindow & { start?: string; end?: string } {
  if (pinned.preset === "ytd") return { kind: "ytd" };
  if (pinned.preset === "trailing_12") return { kind: "trailing", months: 12 };
  if (pinned.preset === "this_vs_last" || pinned.preset === "last_2_years") {
    const y = now.getUTCFullYear();
    return {
      kind: "range",
      start: `${y - 1}-01-01`,
      end: `${y}-12-31`,
    } as MetricWindow & { start: string; end: string };
  }
  return {
    kind: "range",
    start: pinned.start,
    end: pinned.end,
  } as MetricWindow & { start: string; end: string };
}

/**
 * Apply block pinned_window onto a metric definition without mutating the saved metric.
 * Year-compare: rewrite compare.years from the preset (clears last_n_years).
 * Else: override definition.window.
 */
export function definitionWithPinnedWindow(
  definition: MetricDefinition,
  pinned: PinnedWindow | null | undefined,
  now = new Date()
): MetricDefinition {
  if (!pinned) return definition;

  const isYearCompare =
    definition.of === "series_compare" && definition.compare?.by === "year";

  if (isYearCompare) {
    const years = yearsFromPinnedWindow(pinned, now);
    return {
      ...definition,
      compare: {
        by: "year",
        years,
      },
      // Keep a coherent window spanning those years for any axis helpers.
      window: {
        kind: "range",
        start: `${years[0]}-01-01`,
        end: `${years[years.length - 1]}-12-31`,
      } as MetricWindow,
    };
  }

  return {
    ...definition,
    window: pinnedToMetricWindow(pinned, now) as MetricWindow,
  };
}

export const PINNED_WINDOW_PRESETS: Array<{
  id: PinnedWindowPreset;
  label: string;
}> = [
  { id: "ytd", label: "YTD" },
  { id: "trailing_12", label: "Trailing 12" },
  { id: "last_2_years", label: "Last 2 years" },
  { id: "this_vs_last", label: "This year vs last" },
  { id: "custom", label: "Custom" },
];
