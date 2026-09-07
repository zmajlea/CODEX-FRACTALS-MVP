/**
 * Spec B17 M2 — study page composite stored as sibling of summit.results
 * inside derived_snapshot (no new table).
 *
 * Shape:
 *   derived_snapshot = {
 *     results: { …summit.results/v1… },
 *     composite: { exhibits, notes, kpiLayouts },
 *     validationReport, engineBaseline, submittedAt
 *   }
 */

import type { ReviewBlockLayout } from "@/lib/treasury/review-block-layout";
import { parseLayoutOrNull, resolveLayout } from "@/lib/treasury/review-block-layout";

export type StudyCompositeExhibit = {
  id: string;
  title: string;
  chart_hint: "line" | "column";
  points: Array<{
    month: string;
    ending: number;
    projected?: boolean;
  }>;
  reference_lines: Array<{ label: string; value: number; breach?: boolean }>;
  layout: ReviewBlockLayout;
};

export type StudyCompositeNote = {
  id: string;
  body: string;
  layout: ReviewBlockLayout;
};

export type StudyCompositeKpiLayout = {
  id: string;
  layout: ReviewBlockLayout;
};

/** Presentation arrangement — sibling of results in derived_snapshot. */
export type StudyPageComposite = {
  exhibits: StudyCompositeExhibit[];
  notes: StudyCompositeNote[];
  kpiLayouts: StudyCompositeKpiLayout[];
};

export function emptyStudyPageComposite(): StudyPageComposite {
  return { exhibits: [], notes: [], kpiLayouts: [] };
}

export function parseStudyPageComposite(raw: unknown): StudyPageComposite | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const exhibitsRaw = Array.isArray(o.exhibits) ? o.exhibits : [];
  const notesRaw = Array.isArray(o.notes) ? o.notes : [];
  const kpiRaw = Array.isArray(o.kpiLayouts) ? o.kpiLayouts : [];

  const exhibits: StudyCompositeExhibit[] = [];
  for (let i = 0; i < exhibitsRaw.length; i++) {
    const item = exhibitsRaw[i];
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const id = String(e.id ?? `exhibit-${i}`);
    const layout = parseLayoutOrNull(e.layout) ?? { w: 12, h: 2 };
    const pointsRaw = Array.isArray(e.points) ? e.points : [];
    const points: StudyCompositeExhibit["points"] = [];
    for (const p of pointsRaw) {
      if (!p || typeof p !== "object") continue;
      const row = p as Record<string, unknown>;
      const month = String(row.month ?? "").slice(0, 7);
      const ending = Number(row.ending);
      if (!month || !Number.isFinite(ending)) continue;
      points.push({
        month,
        ending,
        projected: row.projected === true ? true : undefined,
      });
    }
    const refsRaw = Array.isArray(e.reference_lines) ? e.reference_lines : [];
    const reference_lines: StudyCompositeExhibit["reference_lines"] = [];
    for (const r of refsRaw) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      const label = String(row.label ?? "");
      const value = Number(row.value);
      if (!label || !Number.isFinite(value)) continue;
      reference_lines.push({
        label,
        value,
        breach: row.breach === true ? true : undefined,
      });
    }
    exhibits.push({
      id,
      title: String(e.title ?? "Exhibit"),
      chart_hint: e.chart_hint === "column" ? "column" : "line",
      points,
      reference_lines,
      layout: resolveLayout(layout),
    });
  }

  const notes: StudyCompositeNote[] = [];
  for (let i = 0; i < notesRaw.length; i++) {
    const item = notesRaw[i];
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    notes.push({
      id: String(n.id ?? `note-${i}`),
      body: String(n.body ?? ""),
      layout: resolveLayout(parseLayoutOrNull(n.layout) ?? { w: 12, h: 1 }),
    });
  }

  const kpiLayouts: StudyCompositeKpiLayout[] = [];
  for (let i = 0; i < kpiRaw.length; i++) {
    const item = kpiRaw[i];
    if (!item || typeof item !== "object") continue;
    const k = item as Record<string, unknown>;
    const layout = parseLayoutOrNull(k.layout);
    if (!layout) continue;
    kpiLayouts.push({
      id: String(k.id ?? `kpi-${i}`),
      layout,
    });
  }

  return { exhibits, notes, kpiLayouts };
}

/** Read composite from a full derived_snapshot blob. */
export function compositeFromDerivedSnapshot(
  derived: unknown
): StudyPageComposite | null {
  if (!derived || typeof derived !== "object") return null;
  return parseStudyPageComposite((derived as { composite?: unknown }).composite);
}

export function newCompositeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
