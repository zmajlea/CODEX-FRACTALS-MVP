"use client";

import type { MetricComparison } from "@/lib/treasury/metrics-eval";

const GROUP_COLORS = [
  "var(--brand, #2C3E50)",
  "var(--brand-2, #3d5166)",
  "var(--accent, #EBC06D)",
  "var(--su-progress, #3498db)",
  "var(--cinnabar, #E67E50)",
];

type Props = {
  comparison: MetricComparison;
  height?: number;
};

/**
 * Spec B14 — multi-series comparison chart (grouped columns or multi-line).
 * Pure presentational; values arrive pre-computed.
 */
export function MetricComparisonChart({ comparison, height = 210 }: Props) {
  const width = 640;
  const padL = 44;
  const padR = 12;
  const padT = 24;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const { groups, axis, reference_lines: referenceLines, chart_hint: chartHint } =
    comparison;

  if (!groups.length || !axis.labels.length) {
    return (
      <p className="treasury-meta text-sm" data-testid="metric-comparison-empty">
        No comparison data.
      </p>
    );
  }

  const allVals = [
    ...groups.flatMap((g) => g.points.map((p) => p.value)),
    ...referenceLines.map((r) => r.value),
    0,
  ];
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const span = maxV - minV || 1;
  const yAt = (v: number) => padT + innerH - ((v - minV) / span) * innerH;

  const nAxis = axis.labels.length;
  const nGroups = groups.length;
  const slot = innerW / nAxis;
  const groupGap = 0.12;
  const barW = Math.max(1, (slot * (1 - groupGap)) / nGroups);

  const xGroupCenter = (axisIdx: number, groupIdx: number) => {
    const slotStart = padL + axisIdx * slot;
    const innerSlot = slot * (1 - groupGap);
    const offset = (innerSlot / nGroups) * groupIdx + innerSlot / nGroups / 2;
    return slotStart + slot * (groupGap / 2) + offset;
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Metric comparison chart"
      data-testid="metric-comparison-chart"
    >
      <line
        x1={padL}
        x2={width - padR}
        y1={yAt(0)}
        y2={yAt(0)}
        stroke="var(--line)"
        strokeWidth={1}
      />

      {chartHint === "grouped_column"
        ? axis.labels.map((_, axisIdx) =>
            groups.map((group, groupIdx) => {
              const p = group.points[axisIdx];
              if (!p) return null;
              const cx = xGroupCenter(axisIdx, groupIdx);
              const x = cx - barW / 2;
              const y0 = yAt(0);
              const y1 = yAt(p.value);
              const top = Math.min(y0, y1);
              const h = Math.max(1, Math.abs(y1 - y0));
              const breached = (p.breaches?.length ?? 0) > 0;
              const color = GROUP_COLORS[groupIdx % GROUP_COLORS.length]!;
              return (
                <rect
                  key={`${group.key}-${axisIdx}`}
                  x={x}
                  y={top}
                  width={barW}
                  height={h}
                  fill={breached ? "var(--cinnabar, #E67E50)" : color}
                  opacity={p.partial ? 0.45 : breached ? 0.85 : 0.7}
                  stroke={p.partial ? "var(--line)" : undefined}
                  strokeDasharray={p.partial ? "2 2" : undefined}
                />
              );
            })
          )
        : null}

      {chartHint === "multi_line"
        ? groups.map((group, groupIdx) => {
            const color = GROUP_COLORS[groupIdx % GROUP_COLORS.length]!;
            const pts = group.points
              .map((p, i) => `${xGroupCenter(i, groupIdx)},${yAt(p.value)}`)
              .join(" ");
            return (
              <polyline
                key={group.key}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                points={pts}
              />
            );
          })
        : null}

      {referenceLines.map((line) => {
        const y = yAt(line.value);
        return (
          <g key={line.id}>
            <line
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              stroke="var(--pulse-amber, #EBC06D)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={width - padR}
              y={y - 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--ink, #1A1A1B)"
              opacity={0.7}
            >
              {line.label}
            </text>
          </g>
        );
      })}

      {axis.labels.map((label, i) => {
        if (nAxis > 12 && i % Math.ceil(nAxis / 8) !== 0 && i !== nAxis - 1) return null;
        return (
          <text
            key={`axis-${label}-${i}`}
            x={padL + i * slot + slot / 2}
            y={height - 8}
            textAnchor="middle"
            fontSize={8}
            fill="var(--ink, #1A1A1B)"
            opacity={0.55}
          >
            {label.length > 8 ? label.slice(0, 8) : label}
          </text>
        );
      })}

      {groups.map((group, groupIdx) => {
        const color = GROUP_COLORS[groupIdx % GROUP_COLORS.length]!;
        return (
          <g key={`leg-${group.key}`}>
            <rect
              x={padL + groupIdx * 72}
              y={4}
              width={10}
              height={10}
              fill={color}
              opacity={0.8}
            />
            <text
              x={padL + groupIdx * 72 + 14}
              y={12}
              fontSize={9}
              fill="var(--ink, #1A1A1B)"
              opacity={0.75}
            >
              {group.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
