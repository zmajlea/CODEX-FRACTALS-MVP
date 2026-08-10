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
    const height = 220;
    const pad = { top: 20, right: 16, bottom: 32, left: 52 };
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
        row: r,
      }));
    const projectedPts = selectedTimeline
      .filter((r) => r.kind === "projected")
      .map((r) => ({
        x: xAt(months.indexOf(r.month)),
        y: yAt(r.ending),
        row: r,
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
    };
  }, [asOf, selectedTimeline, downsideTimeline, showDownside, threshold]);

  if (!selectedTimeline.length) return null;

  return (
    <div className="panel p-3 space-y-2" style={{ border: "1px solid var(--line)" }}>
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
      <div className="fc-chartwrap">
        <svg
          className="fc-svg"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label="Ending cash runway chart"
        >
          <line
            className="fc-grid"
            x1={chart.pad.left}
            y1={chart.thresholdY}
            x2={chart.width - chart.pad.right}
            y2={chart.thresholdY}
          />
          <text
            className="fc-covlabel"
            x={chart.width - chart.pad.right}
            y={chart.thresholdY - 4}
            textAnchor="end"
          >
            Min cash
          </text>
          {chart.seamIdx > 0 ? (
            <>
              <line
                x1={chart.xAt(chart.seamIdx)}
                y1={chart.pad.top}
                x2={chart.xAt(chart.seamIdx)}
                y2={chart.pad.top + chart.innerH}
                stroke="var(--mute)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text
                className="fc-xlabel t"
                x={chart.xAt(chart.seamIdx) + 4}
                y={chart.pad.top + 10}
                fontSize={8}
              >
                Today
              </text>
            </>
          ) : null}
          {chart.actualPath ? (
            <path
              d={chart.actualPath.d}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
            />
          ) : null}
          {chart.projectedPath ? (
            <path
              d={chart.projectedPath.d}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ) : null}
          {chart.downsidePath ? (
            <path
              d={chart.downsidePath.d}
              fill="none"
              stroke="var(--cinnabar,#E67E50)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.85}
            />
          ) : null}
          {chart.breachPt ? (
            <>
              <line
                x1={chart.breachPt.x}
                y1={chart.pad.top}
                x2={chart.breachPt.x}
                y2={chart.pad.top + chart.innerH}
                className="fc-cov"
              />
              <circle
                cx={chart.breachPt.x}
                cy={chart.breachPt.y}
                r={4}
                fill="var(--su-neg)"
              />
            </>
          ) : null}
          {chart.labelIdx.map((i) => (
            <text
              key={chart.months[i]}
              className="fc-xlabel"
              x={chart.xAt(i)}
              y={chart.height - 8}
              textAnchor="middle"
            >
              {monthShort(chart.months[i]!)}
            </text>
          ))}
          <text className="fc-ylabel" x={chart.pad.left - 4} y={chart.yAt(chart.maxY) + 3} textAnchor="end">
            {fmtAxis(chart.maxY)}
          </text>
          <text className="fc-ylabel" x={chart.pad.left - 4} y={chart.yAt(chart.minY) + 3} textAnchor="end">
            {fmtAxis(chart.minY)}
          </text>
        </svg>
      </div>
      {selectedSummary?.breachMonth && !selectedSummary.noBreachInHorizon ? (
        <p className="treasury-meta">
          Breach · {selectedSummary.breachMonth.slice(0, 7)}
          {selectedSummary.runwayMonths != null
            ? ` (${selectedSummary.runwayMonths} months)`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
