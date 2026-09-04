"use client";

import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import { MetricSeriesTable } from "@/components/operator/treasury/analytics/MetricTable";
import {
  isPlacedStudySnapshot,
  type PlacedStudySnapshot,
} from "@/lib/treasury/study-assemble";

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

/** Spec B16 — shared study block renderer (operator + client). */
export function StudyBlockView({
  snapshot,
  viewMode = "chart",
  showProvenance = false,
}: Props) {
  if (!isPlacedStudySnapshot(snapshot)) {
    return <p className="rcx-muted">Study snapshot unavailable.</p>;
  }
  const snap: PlacedStudySnapshot = snapshot;
  const points =
    snap.timeline?.points.map((p) => ({
      bucket_start: `${p.month}-01`,
      bucket_label: p.month,
      value: p.ending,
      partial: p.projected ? (true as const) : undefined,
    })) ?? [];
  const refs =
    snap.timeline?.reference_lines.map((r, i) => ({
      id: `ref-${i}`,
      label: r.label,
      value: r.value,
      kind: r.breach ? "threshold" : "ref",
    })) ?? [];

  return (
    <div className="study-block" data-study-type={snap.type}>
      {snap.kpis.length ? (
        <div
          className="study-kpis"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 12,
          }}
        >
          {snap.kpis.map((k) => (
            <div
              key={k.label}
              style={{
                minWidth: 120,
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
                {k.unit === "usd" || typeof k.value === "number"
                  ? typeof k.value === "number" && (k.unit === "usd" || k.label.toLowerCase().includes("balance"))
                    ? money(k.value)
                    : String(k.value)
                  : String(k.value)}
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
          ))}
        </div>
      ) : null}

      {showProvenance && snap.opening_balance_source ? (
        <p className="rcx-muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Opening balance source: {snap.opening_balance_source}
          {snap.opening_balance_source === "unknown"
            ? " — set a manual opening balance before trusting runway"
            : ""}
        </p>
      ) : null}

      {points.length ? (
        viewMode === "table" ? (
          <MetricSeriesTable
            points={points}
            referenceLines={refs}
          />
        ) : (
          <div className="rcx-chart">
            <MetricChart
              points={points}
              referenceLines={refs}
              chartHint="line"
            />
          </div>
        )
      ) : null}

      {snap.timeline?.breach_month ? (
        <p className="rcx-muted" style={{ fontSize: 12 }}>
          Breach · {snap.timeline.breach_month}
          {snap.timeline.runway_months != null
            ? ` · runway ${snap.timeline.runway_months} mo`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
