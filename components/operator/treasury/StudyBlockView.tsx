"use client";

import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import { MetricSeriesTable } from "@/components/operator/treasury/analytics/MetricTable";
import {
  isPlacedStudySnapshot,
  normalizePlacedStudy,
  type PlacedStudySnapshot,
} from "@/lib/treasury/study-assemble";
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
};

function money(n: number | string): string {
  if (typeof n === "string") return n;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

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

/** Spec B16/B17 M2 — shared study block renderer (operator + client). */
export function StudyBlockView({
  snapshot,
  viewMode = "chart",
  showProvenance = false,
}: Props) {
  if (!isPlacedStudySnapshot(snapshot)) {
    return <p className="rcx-muted">Study snapshot unavailable.</p>;
  }
  const snap: PlacedStudySnapshot = normalizePlacedStudy(snapshot);
  const exhibits = snap.exhibits ?? [];
  const notes = snap.notes ?? [];

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

  function renderExhibit(id: string, forceTile?: boolean) {
    const e = exhibits.find((x) => x.id === id);
    if (!e) return null;
    const layout = resolveLayout(e.layout);
    const asChart = !forceTile && layout.w >= 6;
    const points = e.points.map((p) => ({
      bucket_start: `${p.month}-01`,
      bucket_label: p.month,
      value: p.ending,
      partial: p.projected ? (true as const) : undefined,
    }));
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
          <div className="rcx-muted" style={{ fontSize: 11, fontWeight: 700 }}>
            {e.title}
          </div>
          <div className="rcx-figval">
            {last != null ? money(last) : "—"}
            <span className="rcx-fighint"> · summary</span>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="rcx-muted" style={{ fontSize: 12, marginBottom: 4 }}>
          {e.title}
        </div>
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
          <p className="rcx-muted" style={{ fontSize: 12 }}>
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
      <div
        style={{
          minWidth: 0,
          border: "1px solid var(--su-line, #DED9D1)",
          borderRadius: 8,
          padding: "8px 12px",
          background: "var(--su-paper, #FCFBF9)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--mute)",
            fontWeight: 700,
          }}
        >
          {k.label}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: k.flag === "warn" ? "var(--su-neg, #B42318)" : "var(--ink)",
          }}
        >
          {formatKpiValue(k)}
          {k.unit && k.unit !== "usd" ? (
            <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 4 }}>
              {k.unit}
            </span>
          ) : null}
        </div>
        {showProvenance && k.basis ? (
          <div style={{ fontSize: 11, color: "var(--mute)" }}>{k.basis}</div>
        ) : null}
      </div>
    );
  }

  function renderNote(id: string) {
    const n = notes.find((x) => x.id === id);
    if (!n) return null;
    return (
      <p className="rcx-note" style={{ margin: 0 }}>
        {n.body}
      </p>
    );
  }

  function renderItem(item: CollapseItem, forceTile?: boolean) {
    if (item.role === "figure") return renderKpi(item.sourceIndex);
    if (item.role === "exhibit") return renderExhibit(item.id, forceTile);
    if (item.role === "note") return renderNote(item.id);
    return null;
  }

  return (
    <div className="study-block" data-study-type={snap.type}>
      {showProvenance && snap.opening_balance_source ? (
        <p className="rcx-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Opening balance source: {snap.opening_balance_source}
          {snap.opening_balance_source === "unknown"
            ? " — set a manual opening balance before trusting runway"
            : ""}
        </p>
      ) : null}

      <div className="study-collapse" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {units.map((u, ui) => {
          if (u.kind === "figrow") {
            const cols = Math.min(4, Math.max(1, u.items.length));
            return (
              <div
                key={`fig-${ui}`}
                className={`study-figrow n${cols}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: 12,
                }}
              >
                {u.items.map((it) => (
                  <div key={it.id}>{renderItem(it, true)}</div>
                ))}
              </div>
            );
          }
          if (u.kind === "r84") {
            return (
              <div
                key={`r84-${ui}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 12,
                  alignItems: "start",
                }}
              >
                <div>{renderItem(u.primary)}</div>
                <aside
                  style={{
                    background: "color-mix(in srgb, #0e7490 8%, #fff)",
                    borderRadius: 8,
                    padding: 12,
                    border: "1px solid color-mix(in srgb, #0e7490 20%, #DED9D1)",
                  }}
                >
                  {renderItem(u.side)}
                </aside>
              </div>
            );
          }
          if (u.kind === "r66") {
            return (
              <div
                key={`r66-${ui}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>{renderItem(u.left)}</div>
                <div>{renderItem(u.right)}</div>
              </div>
            );
          }
          const span = gridColumnSpan(u.item.layout, "desktop");
          return (
            <div key={`full-${ui}`} style={{ maxWidth: span <= 6 ? "50%" : "100%" }}>
              {renderItem(u.item)}
            </div>
          );
        })}
      </div>

      {!exhibits.length && !snap.kpis.length && !notes.length ? (
        <p className="rcx-muted">Empty study.</p>
      ) : null}
    </div>
  );
}
