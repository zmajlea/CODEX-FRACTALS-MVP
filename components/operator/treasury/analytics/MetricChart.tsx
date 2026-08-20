"use client";

export type MetricChartPoint = {
  bucket_start: string;
  bucket_label: string;
  value: number;
  partial?: true;
  breaches?: string[];
};

export type MetricChartRefLine = {
  id: string;
  label: string;
  value: number;
  kind: string;
};

type Props = {
  points: MetricChartPoint[];
  referenceLines?: MetricChartRefLine[];
  chartHint?: "column" | "line";
  height?: number;
};

/**
 * Spec B5 — dumb SVG chart from the series envelope (no math).
 * Column or line; dashed labeled reference lines; breached buckets tinted.
 */
export function MetricChart({
  points,
  referenceLines = [],
  chartHint = "column",
  height = 180,
}: Props) {
  const width = 640;
  const padL = 44;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  if (!points.length) {
    return (
      <p className="treasury-meta text-sm" data-testid="metric-chart-empty">
        No points in range.
      </p>
    );
  }

  const vals = [
    ...points.map((p) => p.value),
    ...referenceLines.map((r) => r.value),
    0,
  ];
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = maxV - minV || 1;
  const yAt = (v: number) => padT + innerH - ((v - minV) / span) * innerH;
  const n = points.length;
  const gap = chartHint === "column" ? 0.25 : 0;
  const slot = innerW / n;
  const barW = Math.max(1, slot * (1 - gap));

  const xCenter = (i: number) => padL + i * slot + slot / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Metric series chart"
      data-testid="metric-chart"
    >
      {/* zero / axis */}
      <line
        x1={padL}
        x2={width - padR}
        y1={yAt(0)}
        y2={yAt(0)}
        stroke="var(--line)"
        strokeWidth={1}
      />

      {chartHint === "column"
        ? points.map((p, i) => {
            const x = padL + i * slot + (slot - barW) / 2;
            const y0 = yAt(0);
            const y1 = yAt(p.value);
            const top = Math.min(y0, y1);
            const h = Math.max(1, Math.abs(y1 - y0));
            const breached = (p.breaches?.length ?? 0) > 0;
            return (
              <rect
                key={p.bucket_start}
                x={x}
                y={top}
                width={barW}
                height={h}
                fill={breached ? "var(--cinnabar, #E67E50)" : "var(--ink, #1A1A1B)"}
                opacity={breached ? 0.85 : 0.55}
              />
            );
          })
        : null}

      {chartHint === "line" ? (
        <polyline
          fill="none"
          stroke="var(--ink, #1A1A1B)"
          strokeWidth={1.5}
          points={points
            .map((p, i) => `${xCenter(i)},${yAt(p.value)}`)
            .join(" ")}
        />
      ) : null}

      {chartHint === "line"
        ? points.map((p, i) => {
            const breached = (p.breaches?.length ?? 0) > 0;
            return (
              <circle
                key={p.bucket_start}
                cx={xCenter(i)}
                cy={yAt(p.value)}
                r={breached ? 3.5 : 2}
                fill={breached ? "var(--cinnabar, #E67E50)" : "var(--ink, #1A1A1B)"}
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

      {/* sparse x labels */}
      {points.map((p, i) => {
        if (n > 12 && i % Math.ceil(n / 8) !== 0 && i !== n - 1) return null;
        return (
          <text
            key={`lbl-${p.bucket_start}`}
            x={xCenter(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize={8}
            fill="var(--ink, #1A1A1B)"
            opacity={0.55}
          >
            {p.bucket_label.length > 10
              ? p.bucket_label.slice(0, 10)
              : p.bucket_label}
          </text>
        );
      })}
    </svg>
  );
}
