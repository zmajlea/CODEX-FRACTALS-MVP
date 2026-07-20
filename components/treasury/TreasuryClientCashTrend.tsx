"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import type { SummaryGranularity, TreasurySummaryRow } from "@/lib/treasury/types";

function formatAxisAmount(value: number, currency: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return formatTreasuryMoney(value, currency).replace(/\.00$/, "");
}

function formatChartXLabel(granularity: SummaryGranularity, periodStart: string): string {
  if (granularity === "month") {
    const d = new Date(periodStart + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (granularity === "week") return periodStart.slice(5);
  return periodStart.slice(5);
}

function pickXLabelIndices(n: number): number[] {
  if (n <= 1) return [0];
  if (n <= 4) return Array.from({ length: n }, (_, i) => i);
  const indices = new Set([0, n - 1, Math.floor(n / 2)]);
  return [...indices].sort((a, b) => a - b);
}

function NetCashChart({
  rows,
  currency,
  granularity,
}: {
  rows: TreasurySummaryRow[];
  currency: string;
  granularity: SummaryGranularity;
}) {
  const width = 640;
  const height = 200;
  const pad = { top: 16, right: 12, bottom: 28, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = rows.length || 1;
  const barGap = 3;
  const barW = Math.max(3, (innerW - barGap * (n - 1)) / n);
  const nets = rows.map((b) => b.net);
  const maxAbs = Math.max(1, ...nets.map((v) => Math.abs(v)));
  const zeroY = pad.top + innerH / 2;
  const labelIndices = pickXLabelIndices(n);
  const yTicks = [maxAbs, 0, -maxAbs];

  return (
    <div className="fc-chartwrap">
      <svg
        className="fc-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cash flow by month"
      >
        {yTicks.map((tick) => {
          const y = zeroY - (tick / maxAbs) * (innerH / 2 - 4);
          return (
            <g key={`ytick-${tick}`}>
              <line
                className={tick === 0 ? "fc-zero" : "fc-grid"}
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
              />
              <text className="fc-ylabel" x={pad.left - 4} y={y + 3} textAnchor="end">
                {tick === 0 ? "0" : formatAxisAmount(tick, currency)}
              </text>
            </g>
          );
        })}
        {rows.map((bar, i) => {
          const x = pad.left + i * (barW + barGap);
          const barH = (Math.abs(bar.net) / maxAbs) * (innerH / 2 - 4);
          const y = bar.net >= 0 ? zeroY - barH : zeroY;
          const signClass = bar.net >= 0 ? "pos" : "neg";
          return (
            <g key={bar.period_start}>
              <rect
                className={`fc-bar ${signClass}`}
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, bar.net === 0 ? 0 : 2)}
                rx={2}
              />
              {labelIndices.includes(i) ? (
                <text className="fc-xlabel" x={x + barW / 2} y={height - 6} textAnchor="middle">
                  {formatChartXLabel(granularity, bar.period_start)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

type SummaryResponse = {
  primary_currency: string;
  rows: TreasurySummaryRow[];
  other_rows: TreasurySummaryRow[];
  granularity: SummaryGranularity;
};

export function TreasuryClientCashTrend() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/treasury/summary?granularity=month&periods=12");
      if (res.ok) {
        setData((await res.json()) as SummaryResponse);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to load cash flow");
      }
      setLoading(false);
    })();
  }, []);

  const excludedNote = useMemo(() => {
    if (!data?.other_rows.length) return null;
    const currencies = [...new Set(data.other_rows.map((r) => r.iso_currency_code))];
    return currencies.join(", ");
  }, [data]);

  return (
    <section className="cash-hero" style={{ marginTop: 22 }} aria-label="Cash flow by month">
      <div className="ch-l">Cash flow by month</div>
      {loading ? (
        <p className="meta">Loading cash flow…</p>
      ) : error ? (
        <p className="panel-note" role="alert">
          {error}
        </p>
      ) : data ? (
        <>
          <NetCashChart rows={data.rows} currency={data.primary_currency} granularity={data.granularity} />
          <p className="meta" style={{ marginTop: 8 }}>
            Net of receipts and disbursements in {data.primary_currency}.
            {excludedNote
              ? ` Other currencies (${excludedNote}) are shown separately and not combined.`
              : null}
          </p>
        </>
      ) : null}
    </section>
  );
}
