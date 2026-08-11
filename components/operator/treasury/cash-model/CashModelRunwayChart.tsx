"use client";

import { useMemo, useState } from "react";
import type { CashModelTimelineRow } from "@/lib/treasury/cash-model";

type Props = {
  asOf: string;
  threshold: number;
  selectedTimeline: CashModelTimelineRow[];
  downsideTimeline?: CashModelTimelineRow[];
  selectedScenarioId: string;
  selectedSummary?: {
    breachMonth: string | null;
    runwayMonths: number | null;
    noBreachInHorizon: boolean;
  };
};

function monthShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function fmtAxis(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

function linePath(
  points: Array<{ x: number; y: number }>,
  dashed: boolean
): { d: string; dashed: boolean } | null {
  if (points.length < 2) return null;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  return { d, dashed };
}

/** Spec 68 Part C — guide-style runway SVG (tokens only). */
export function CashModelRunwayChart({
  asOf,
  threshold,
  selectedTimeline,
  downsideTimeline,
  selectedScenarioId,
  selectedSummary,
}: Props) {
  const [showDownside, setShowDownside] = useState(false);

  const chart = useMemo(() => {
    const width = 640;
    const height = 240;
    const pad = { top: 28, right: 16, bottom: 36, left: 52 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const months = selectedTimeline.map((r) => r.month);
    const n = months.length || 1;

    const endings = selectedTimeline.map((r) => r.ending);
    const allY = [...endings, threshold];
    if (showDownside && downsideTimeline?.length) {
      allY.push(...downsideTimeline.map((r) => r.ending));
    }
    const minY = Math.min(...allY, 0);
    const maxY = Math.max(...allY, threshold * 1.05);
    const span = Math.max(maxY - minY, 1);

    const xAt = (i: number) => pad.left + (i / Math.max(n - 1, 1)) * innerW;
    const yAt = (v: number) => pad.top + innerH - ((v - minY) / span) * innerH;

    const asOfMonth = asOf.slice(0, 7);
    const seamIdx = selectedTimeline.findIndex(
      (r) => r.kind === "projected" || r.month.slice(0, 7) >= asOfMonth
    );

    const actualPts = selectedTimeline
      .filter((r) => r.kind === "actual")
      .map((r) => ({
        x: xAt(months.indexOf(r.month)),
        y: yAt(r.ending),
      }));
    const projectedPts = selectedTimeline
      .filter((r) => r.kind === "projected")
      .map((r) => ({
        x: xAt(months.indexOf(r.month)),
        y: yAt(r.ending),
      }));

    if (actualPts.length && projectedPts.length) {
      projectedPts.unshift(actualPts[actualPts.length - 1]!);
    }

    const downsidePts =
      showDownside && downsideTimeline
        ? downsideTimeline.map((r) => ({
            x: xAt(months.indexOf(r.month)),
            y: yAt(r.ending),
          }))
        : [];

    const breachRow = selectedTimeline.find(
      (r) => r.kind === "projected" && r.breachFlag
    );
    const breachPt = breachRow
      ? { x: xAt(months.indexOf(breachRow.month)), y: yAt(breachRow.ending) }
      : null;

    const ticks = [maxY, (maxY + minY) / 2, minY].map((v) => ({
      v,
      y: yAt(v),
    }));

    const labelIdx = [0, Math.floor((n - 1) / 2), n - 1].filter(
      (v, i, a) => a.indexOf(v) === i
    );

    return {
      width,
      height,
      pad,
      innerH,
      minY,
      maxY,
      xAt,
      yAt,
      seamIdx,
      actualPath: linePath(actualPts, false),
      projectedPath: linePath(projectedPts, true),
      downsidePath: linePath(downsidePts, true),
      thresholdY: yAt(threshold),
      breachPt,
      labelIdx,
      months,
      ticks,
    };
  }, [asOf, selectedTimeline, downsideTimeline, showDownside, threshold]);

  if (!selectedTimeline.length) return null;

  return (
    <div className="cm-runway panel p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="sec-title mb-0">Runway</p>
        {downsideTimeline && selectedScenarioId !== "downside" ? (
          <label className="treasury-meta text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDownside}
              onChange={(e) => setShowDownside(e.target.checked)}
            />
            Show Downside
          </label>
        ) : null}
      </div>
      <div className="cm-chartbox fc-chartwrap">
        <svg
          className="fc-svg cm-runway-svg"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label="Ending cash runway chart"
        >
          {chart.ticks.map((t) => (
            <g key={`tick-${t.v}`}>
              <line
                className="cm-grid"
                x1={chart.pad.left}
                y1={t.y}
                x2={chart.width - chart.pad.right}
                y2={t.y}
              />
              <text
                className="fc-ylabel"
                x={chart.pad.left - 4}
                y={t.y + 3}
                textAnchor="end"
              >
                {fmtAxis(t.v)}
              </text>
            </g>
          ))}
          <line
            className="cm-floor"
            x1={chart.pad.left}
            y1={chart.thresholdY}
            x2={chart.width - chart.pad.right}
            y2={chart.thresholdY}
          />
          <text
            className="cm-floor-label"
            x={chart.width - chart.pad.right}
            y={chart.thresholdY - 4}
            textAnchor="end"
          >
            Minimum cash
          </text>
          {chart.seamIdx > 0 ? (
            <>
              <line
                className="cm-today"
                x1={chart.xAt(chart.seamIdx)}
                y1={chart.pad.top}
                x2={chart.xAt(chart.seamIdx)}
                y2={chart.pad.top + chart.innerH}
              />
              <text
                className="cm-today-label"
                x={chart.xAt(chart.seamIdx)}
                y={chart.pad.top - 6}
                textAnchor="middle"
              >
                today
              </text>
            </>
          ) : null}
          {chart.actualPath ? (
            <path
              className="cm-path-actual"
              d={chart.actualPath.d}
              fill="none"
            />
          ) : null}
          {chart.projectedPath ? (
            <path
              className="cm-path-projected"
              d={chart.projectedPath.d}
              fill="none"
              strokeDasharray="6 5"
            />
          ) : null}
          {chart.downsidePath ? (
            <path
              className="cm-path-downside"
              d={chart.downsidePath.d}
              fill="none"
              strokeDasharray="4 4"
            />
          ) : null}
          {chart.breachPt ? (
            <>
              <line
                className="cm-breach-line"
                x1={chart.breachPt.x}
                y1={chart.pad.top}
                x2={chart.breachPt.x}
                y2={chart.pad.top + chart.innerH}
              />
              <circle
                className="cm-breach-dot"
                cx={chart.breachPt.x}
                cy={chart.breachPt.y}
                r={4.5}
              />
            </>
          ) : null}
          {chart.labelIdx.map((i) => (
            <text
              key={chart.months[i]}
              className="fc-xlabel"
              x={chart.xAt(i)}
              y={chart.height - 10}
              textAnchor="middle"
            >
              {monthShort(chart.months[i]!)}
            </text>
          ))}
        </svg>
      </div>
      <p className="cm-chart-caption treasury-meta">
        Solid line: recent history from the ledger. Dashed: the next months under
        the assumptions. The flat line is the minimum-cash floor; the marker is
        the first month below it.
        {selectedSummary?.breachMonth && !selectedSummary.noBreachInHorizon
          ? ` Breach · ${selectedSummary.breachMonth.slice(0, 7)}${
              selectedSummary.runwayMonths != null
                ? ` (${selectedSummary.runwayMonths} months)`
                : ""
            }.`
          : ""}
      </p>
    </div>
  );
}
