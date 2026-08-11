"use client";

import { useMemo } from "react";
import {
  CASH_MODEL_BUCKET_KEYS,
  type CashModelBucketKey,
} from "@/lib/treasury/cash-model-types";
import type { CashModelTimelineRow } from "@/lib/treasury/cash-model";

type Props = {
  timeline: CashModelTimelineRow[];
};

const BUCKET_LABELS: Record<CashModelBucketKey, string> = {
  collections: "Collections",
  other_income: "Other in",
  payroll: "Payroll",
  opex: "Opex",
  debt_service: "Debt svc",
  capex: "Capex",
  other_out: "Other out",
  uncategorized_in: "Uncat in",
  uncategorized_out: "Uncat out",
};

const BUCKET_ORDER: CashModelBucketKey[] = [
  "collections",
  "other_income",
  "uncategorized_in",
  "payroll",
  "opex",
  "debt_service",
  "capex",
  "other_out",
  "uncategorized_out",
];

function monthShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function CashModelExplainChart({ timeline }: Props) {
  const chart = useMemo(() => {
    const width = 640;
    const height = 240;
    const pad = { top: 16, right: 12, bottom: 36, left: 48 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const n = timeline.length || 1;
    const barGap = 4;
    const barW = Math.max(6, (innerW - barGap * (n - 1)) / n);

    const maxTotal = Math.max(
      1,
      ...timeline.map((row) => {
        let t = 0;
        for (const b of CASH_MODEL_BUCKET_KEYS) {
          t += Math.abs(row.byBucket[b] ?? 0);
        }
        return t;
      })
    );

    const labelIdx = [0, Math.floor((n - 1) / 2), n - 1].filter(
      (v, i, a) => a.indexOf(v) === i
    );

    return { width, height, pad, innerH, barW, barGap, maxTotal, labelIdx, n };
  }, [timeline]);

  if (!timeline.length) return null;

  return (
    <div className="panel p-3 space-y-2" style={{ border: "1px solid var(--line)" }}>
      <p className="sec-title">By bucket</p>
      <div className="fc-chartwrap">
        <svg
          className="fc-svg"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label="Monthly flows by bucket"
        >
          <line
            className="fc-zero"
            x1={chart.pad.left}
            y1={chart.pad.top + chart.innerH}
            x2={chart.width - chart.pad.right}
            y2={chart.pad.top + chart.innerH}
          />
          {timeline.map((row, i) => {
            const x = chart.pad.left + i * (chart.barW + chart.barGap);
            let yCursor = chart.pad.top + chart.innerH;
            const slices = BUCKET_ORDER.map((bucket) => {
              const raw = row.byBucket[bucket] ?? 0;
              const mag = Math.abs(raw);
              const h = (mag / chart.maxTotal) * (chart.innerH - 8);
              yCursor -= h;
              return { bucket, h, y: yCursor, raw };
            }).filter((s) => s.h > 0.5);

            return (
              <g key={`${row.month}-${row.kind}`}>
                {slices.map((s) => (
                  <rect
                    key={s.bucket}
                    x={x}
                    y={s.y}
                    width={chart.barW}
                    height={s.h}
                    rx={1}
                    fill={
                      s.bucket.startsWith("uncategorized")
                        ? "color-mix(in srgb, var(--mute) 55%, var(--paper))"
                        : s.raw >= 0
                          ? "color-mix(in srgb, var(--brand-2) 70%, var(--paper))"
                          : "color-mix(in srgb, var(--su-neg) 75%, var(--paper))"
                    }
                    opacity={row.kind === "projected" ? 0.72 : 1}
                  />
                ))}
                <title>
                  {monthShort(row.month)} · NCF {Math.round(row.ncf)}
                </title>
              </g>
            );
          })}
          {timeline.map((row, i) => {
            const x = chart.pad.left + i * (chart.barW + chart.barGap) + chart.barW / 2;
            // Spec 65-R: signed NCF for the overlay dot only — bar magnitudes stay abs.
            const midY = chart.pad.top + chart.innerH / 2;
            const amp = (chart.innerH / 2 - 4) / chart.maxTotal;
            const y = midY - row.ncf * amp;
            return (
              <circle
                key={`ncf-${row.month}`}
                cx={x}
                cy={y}
                r={2}
                fill={
                  row.ncf >= 0
                    ? "var(--ink)"
                    : "color-mix(in srgb, var(--su-neg) 85%, var(--ink))"
                }
                opacity={0.7}
              />
            );
          })}
          {chart.labelIdx.map((i) => (
            <text
              key={timeline[i]!.month}
              className="fc-xlabel"
              x={chart.pad.left + i * (chart.barW + chart.barGap) + chart.barW / 2}
              y={chart.height - 10}
              textAnchor="middle"
            >
              {monthShort(timeline[i]!.month)}
            </text>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-2 treasury-meta text-xs">
        {BUCKET_ORDER.filter((b) => b.startsWith("uncategorized") || !b.includes("other")).map(
          (b) => (
            <span key={b} className="chip prov-assumed">
              {BUCKET_LABELS[b]}
            </span>
          )
        )}
        <span className="chip prov-pulled">NCF dots overlaid</span>
      </div>
    </div>
  );
}
