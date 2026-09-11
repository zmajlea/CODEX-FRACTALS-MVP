"use client";

import { type ReactNode } from "react";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import { MetricSeriesTable } from "@/components/operator/treasury/analytics/MetricTable";
import { PickButton } from "@/components/operator/treasury/PickButton";
import {
  isPlacedStudySnapshot,
  normalizePlacedStudy,
  type PlacedStudyExhibit,
  type PlacedStudyKpi,
  type PlacedStudySnapshot,
} from "@/lib/treasury/study-assemble";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import {
  gridColumnSpan,
  resolveLayout,
} from "@/lib/treasury/review-block-layout";
import {
  collapseLayoutUnits,
  type CollapseItem,
} from "@/lib/treasury/review-layout-collapse";

type Props = {
  snapshot: unknown;
  viewMode?: "chart" | "table";
  /** Operator chrome (opening-balance provenance). */
  showProvenance?: boolean;
  /** Spec B23 — per-section pick into DraftsRail. */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

function money(n: number | string): string {
  if (typeof n === "string") return n;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Spec B21 — confidence grade labels (colors via CSS `[data-grade]`). */
const GRADE_LABEL: Record<string, string> = {
  solid: "Solid",
  indicative: "Indicative",
  thin: "Thin",
  refused: "Refused",
};

function formatKpiValue(k: {
  label: string;
  value: number | string;
  unit?: string;
}): string {
  if (typeof k.value === "number" && (k.unit === "usd" || k.label.toLowerCase().includes("balance"))) {
    return money(k.value);
  }
  return String(k.value);
}

function pointRange(e: PlacedStudyExhibit): { from: string; to: string } {
  const months: string[] = [];
  for (const p of e.points) {
    if ("month" in p && typeof p.month === "string") {
      months.push(p.month.slice(0, 7));
    } else if ("label" in p && typeof (p as { label?: string }).label === "string") {
      months.push(String((p as { label: string }).label).slice(0, 10));
    }
  }
  const from = months[0] ?? "2000-01-01";
  const to = months[months.length - 1] ?? from;
  return {
    from: from.length === 7 ? `${from}-01` : from,
    to: to.length === 7 ? `${to}-28` : to,
  };
}

function exhibitPickable(
  snap: PlacedStudySnapshot,
  e: PlacedStudyExhibit
): Pickable {
  const { from, to } = pointRange(e);
  const label = e.title || snap.name || "Section";
  if (snap.type === "forecast" || snap.type === "seasonality") {
    return {
      kind: "forecast",
      label,
      params: {
        metric: label,
        from,
        to,
        study_id: snap.study_id,
        exhibit_id: e.id,
      },
      snap: { label, study_id: snap.study_id, exhibit_id: e.id },
    };
  }
  return {
    kind: "figure",
    label,
    params: {
      metric: label,
      from,
      to,
      study_id: snap.study_id,
      exhibit_id: e.id,
    },
    snap: { label, study_id: snap.study_id, exhibit_id: e.id },
  };
}

function kpiPickable(snap: PlacedStudySnapshot, k: PlacedStudyKpi): Pickable {
  const asOf = snap.as_of?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return {
    kind: "figure",
    label: k.label,
    params: {
      metric: k.label,
      from: asOf,
      to: asOf,
      study_id: snap.study_id,
    },
    snap: {
      label: k.label,
      value: k.value,
      study_id: snap.study_id,
    },
  };
}

/** Spec B16/B17 M2 — shared study block renderer (operator + client). */
export function StudyBlockView({
  snapshot,
  viewMode = "chart",
  showProvenance = false,
  onPick,
}: Props) {
  if (!isPlacedStudySnapshot(snapshot)) {
    return <p className="rcx-muted">Study snapshot unavailable.</p>;
  }
  const snap: PlacedStudySnapshot = normalizePlacedStudy(snapshot);
  const exhibits = snap.exhibits ?? [];
  const notes = snap.notes ?? [];
  const assumptions = snap.assumptions ?? [];
  const confidence = snap.confidence;
  const methodNote = snap.method_note;

  const collapseItems: CollapseItem[] = [
    ...snap.kpis.map((k, i) => ({
      id: k.id ?? `kpi-${i}`,
      role: "figure" as const,
      layout: resolveLayout(k.layout ?? { w: 3, h: 1 }),
      sourceIndex: i,
    })),
    ...exhibits.map((e, i) => ({
      id: e.id,
      role: "exhibit" as const,
      layout: resolveLayout(e.layout),
      sourceIndex: 1000 + i,
    })),
    ...notes.map((n, i) => ({
      id: n.id,
      role: "note" as const,
      layout: resolveLayout(n.layout),
      sourceIndex: 2000 + i,
    })),
  ];
  const units = collapseLayoutUnits(collapseItems);

  function sectionPick(item: CollapseItem) {
    if (!onPick) return null;
    if (item.role === "exhibit") {
      const e = exhibits.find((x) => x.id === item.id);
      if (!e) return null;
      return (
        <PickButton
          variant="row"
          pickable={exhibitPickable(snap, e)}
          onPick={onPick}
          ariaLabel={`Add ${e.title || "section"} to a draft`}
        />
      );
    }
    if (item.role === "figure") {
      const k = snap.kpis[item.sourceIndex];
      if (!k) return null;
      return (
        <PickButton
          variant="row"
          pickable={kpiPickable(snap, k)}
          onPick={onPick}
          ariaLabel={`Add ${k.label} to a draft`}
        />
      );
    }
    return null;
  }

  function renderExhibit(id: string, forceTile?: boolean) {
    const e = exhibits.find((x) => x.id === id);
    if (!e) return null;
    const layout = resolveLayout(e.layout);
    const asChart = !forceTile && layout.w >= 6;
    const analytics = e.series_kind === "analytics";
    const points = e.points.map((p) => {
      if (analytics || ("label" in p && !("month" in p))) {
        const ap = p as { label: string; value: number };
        return {
          bucket_start: ap.label,
          bucket_label: ap.label,
          value: ap.value,
        };
      }
      const cp = p as { month: string; ending: number; projected?: boolean };
      return {
        bucket_start: `${cp.month}-01`,
        bucket_label: cp.month,
        value: cp.ending,
        partial: cp.projected ? (true as const) : undefined,
      };
    });
    const refs = e.reference_lines.map((r, i) => ({
      id: `ref-${i}`,
      label: r.label,
      value: r.value,
      kind: r.breach ? "threshold" : "ref",
    }));
    if (!asChart) {
      const last = points[points.length - 1]?.value;
      return (
        <div>
          <div className="rcx-muted study-ex-title">{e.title}</div>
          <div className="rcx-figval">
            {last != null ? money(last) : "—"}
            <span className="rcx-fighint"> · summary</span>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="rcx-muted study-ex-title-lg">{e.title}</div>
        {viewMode === "table" ? (
          <MetricSeriesTable points={points} referenceLines={refs} />
        ) : (
          <div className="rcx-chart">
            <MetricChart
              points={points}
              referenceLines={refs}
              chartHint={e.chart_hint === "line" ? "line" : "column"}
              height={210}
            />
          </div>
        )}
        {e.breach_month ? (
          <p className="rcx-muted study-breach">
            Breach · {e.breach_month}
            {e.runway_months != null ? ` · runway ${e.runway_months} mo` : ""}
          </p>
        ) : null}
      </div>
    );
  }

  function renderKpi(index: number) {
    const k = snap.kpis[index];
    if (!k) return null;
    return (
      <div className={`study-kpi${k.flag === "warn" ? " warn" : ""}`}>
        <div className="study-kpi-label">{k.label}</div>
        <div className="study-kpi-value">
          {formatKpiValue(k)}
          {k.unit && k.unit !== "usd" ? (
            <span className="study-kpi-unit">{k.unit}</span>
          ) : null}
        </div>
        {showProvenance && k.basis ? (
          <div className="study-kpi-basis">{k.basis}</div>
        ) : null}
      </div>
    );
  }

  function renderNote(id: string) {
    const n = notes.find((x) => x.id === id);
    if (!n) return null;
    return (
      <p className="rcx-note study-note">{n.body}</p>
    );
  }

  function renderItem(item: CollapseItem, forceTile?: boolean) {
    if (item.role === "figure") return renderKpi(item.sourceIndex);
    if (item.role === "exhibit") return renderExhibit(item.id, forceTile);
    if (item.role === "note") return renderNote(item.id);
    return null;
  }

  function wrapWithPick(item: CollapseItem, body: ReactNode) {
    const pick = sectionPick(item);
    if (!pick) return body;
    return (
      <div className="study-pickwrap">
        <div className="study-pickslot">{pick}</div>
        {body}
      </div>
    );
  }

  const methodBody =
    [methodNote, confidence?.note].filter(Boolean).join(" · ") || "";

  return (
    <div className="study-block" data-study-type={snap.type}>
      {confidence || assumptions.length ? (
        <div className="study-chrome">
          {confidence ? (
            <span className="study-conf" data-grade={confidence.grade}>
              {GRADE_LABEL[confidence.grade] ?? confidence.grade}
            </span>
          ) : null}
          {assumptions.map((a, i) => (
            <span key={i} className="study-assump">
              {a}
            </span>
          ))}
        </div>
      ) : null}

      {showProvenance && snap.opening_balance_source ? (
        <p className="rcx-muted study-ob-source">
          Opening balance source: {snap.opening_balance_source}
          {snap.opening_balance_source === "unknown"
            ? " — set a manual opening balance before trusting runway"
            : ""}
        </p>
      ) : null}

      <div className="study-collapse">
        {units.map((u, ui) => {
          if (u.kind === "figrow") {
            const cols = Math.min(4, Math.max(1, u.items.length));
            return (
              <div key={`fig-${ui}`} className={`study-figrow n${cols}`}>
                {u.items.map((it) => (
                  <div key={it.id}>
                    {wrapWithPick(it, renderItem(it, true))}
                  </div>
                ))}
              </div>
            );
          }
          if (u.kind === "r84") {
            return (
              <div key={`r84-${ui}`} className="study-row r84">
                <div>{wrapWithPick(u.primary, renderItem(u.primary))}</div>
                <aside className="study-aside">
                  {wrapWithPick(u.side, renderItem(u.side, true))}
                </aside>
              </div>
            );
          }
          if (u.kind === "r66") {
            return (
              <div key={`r66-${ui}`} className="study-row r66">
                <div>{wrapWithPick(u.left, renderItem(u.left))}</div>
                <div>{wrapWithPick(u.right, renderItem(u.right))}</div>
              </div>
            );
          }
          const span = gridColumnSpan(u.item.layout, "desktop");
          return (
            <div
              key={`full-${ui}`}
              className={span <= 6 ? "study-half" : "study-full"}
            >
              {wrapWithPick(u.item, renderItem(u.item))}
            </div>
          );
        })}
      </div>

      {methodBody ? (
        <details className="study-methodnote">
          <summary>How this was computed</summary>
          <p className="study-methodnote-body rcx-muted">{methodBody}</p>
        </details>
      ) : null}

      {!exhibits.length && !snap.kpis.length && !notes.length ? (
        <p className="rcx-muted">Empty study.</p>
      ) : null}
    </div>
  );
}
