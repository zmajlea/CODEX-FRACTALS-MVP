"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TreasuryForecastDrillModal } from "@/components/operator/treasury/TreasuryForecastDrillModal";
import { TreasuryPeriodDrillModal } from "@/components/operator/treasury/TreasuryPeriodDrillModal";
import { formatTreasuryAsOf, formatTreasuryMoney, TREASURY_DISPLAY_LOCALE } from "@/lib/treasury/format";
import { periodLabel } from "@/lib/treasury/period-bounds";
import type {
  SummaryBucket,
  SummaryGranularity,
  TreasuryForecastPeriod,
  TreasuryForecastResponse,
  TreasurySummaryResponse,
  TreasurySummaryRow,
} from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  hasSyncedData?: boolean;
  onSelectPeriod?: (bucket: SummaryBucket, periodStart: string) => void;
};

const GRANULARITIES: { id: SummaryGranularity; label: string; defaultPeriods: number }[] = [
  { id: "day", label: "Daily", defaultPeriods: 30 },
  { id: "week", label: "Weekly", defaultPeriods: 12 },
  { id: "month", label: "Monthly", defaultPeriods: 12 },
];

type ChartBar =
  | { kind: "history"; period_start: string; net: number }
  | { kind: "forecast"; period_start: string; net: number; closing: number };

function formatAxisAmount(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return new Intl.NumberFormat(TREASURY_DISPLAY_LOCALE, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  }
  if (abs >= 10_000) {
    return new Intl.NumberFormat(TREASURY_DISPLAY_LOCALE, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  }
  return formatTreasuryMoney(amount, currency);
}

function pickXLabelIndices(count: number, maxLabels = 6): Set<number> {
  if (count <= 0) return new Set();
  if (count <= maxLabels) return new Set(Array.from({ length: count }, (_, i) => i));
  const indices = new Set<number>([0, count - 1]);
  const interior = maxLabels - 2;
  for (let i = 1; i <= interior; i++) {
    indices.add(Math.round((i * (count - 1)) / (interior + 1)));
  }
  return indices;
}

function formatChartXLabel(granularity: SummaryGranularity, periodStart: string): string {
  if (granularity === "month") {
    const d = new Date(periodStart + "T12:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (granularity === "week") {
    return periodStart.slice(5);
  }
  return periodStart.slice(5);
}

function CashFlowChart({
  bars,
  currency,
  granularity,
  onHistorySelect,
  onForecastSelect,
}: {
  bars: ChartBar[];
  currency: string;
  granularity: SummaryGranularity;
  onHistorySelect: (row: TreasurySummaryRow) => void;
  onForecastSelect: (period: TreasuryForecastPeriod) => void;
}) {
  const width = 640;
  const height = 200;
  const pad = { top: 16, right: 12, bottom: 28, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = bars.length || 1;
  const barGap = 3;
  const barW = Math.max(3, (innerW - barGap * (n - 1)) / n);
  const nets = bars.map((b) => b.net);
  const maxAbs = Math.max(1, ...nets.map((v) => Math.abs(v)));
  const zeroY = pad.top + innerH / 2;
  const todayIdx = bars.findIndex((b) => b.kind === "forecast");
  const dividerX =
    todayIdx > 0 ? pad.left + todayIdx * (barW + barGap) - barGap / 2 : null;
  const labelIndices = pickXLabelIndices(n);
  const yTicks = [maxAbs, 0, -maxAbs];

  return (
    <div className="fc-chartwrap">
      <svg
        className="fc-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cash flow history and forecast"
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
        {dividerX != null ? (
          <>
            <line
              x1={dividerX}
              y1={pad.top}
              x2={dividerX}
              y2={pad.top + innerH}
              stroke="var(--mute)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text className="fc-xlabel t" x={dividerX + 4} y={pad.top + 10} fontSize={8}>
              today
            </text>
          </>
        ) : null}
        {bars.map((bar, i) => {
          const x = pad.left + i * (barW + barGap);
          const barH = (Math.abs(bar.net) / maxAbs) * (innerH / 2 - 4);
          const y = bar.net >= 0 ? zeroY - barH : zeroY;
          const signClass = bar.net >= 0 ? "pos" : "neg";
          const forecastClass = bar.kind === "forecast" ? "forecast" : "";
          return (
            <g key={`${bar.kind}-${bar.period_start}`}>
              <rect
                className={`fc-bar ${signClass} ${forecastClass}`.trim()}
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, bar.net === 0 ? 0 : 2)}
                rx={2}
              />
              <rect
                x={x}
                y={pad.top}
                width={barW}
                height={innerH}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => {
                  if (bar.kind === "history") {
                    onHistorySelect({
                      period_start: bar.period_start,
                      iso_currency_code: currency,
                      inflow: 0,
                      outflow: 0,
                      net: bar.net,
                      count: 0,
                    });
                  } else {
                    onForecastSelect({
                      period_start: bar.period_start,
                      recurring: [],
                      baseline_inflow: 0,
                      baseline_outflow: 0,
                      projected_receipts: 0,
                      projected_disbursements: 0,
                      net: bar.net,
                      closing: bar.closing,
                    });
                  }
                }}
              >
                <title>
                  {periodLabel(granularity, bar.period_start)}:{" "}
                  {formatTreasuryMoney(bar.net, currency)}
                </title>
              </rect>
              {labelIndices.has(i) ? (
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

export function TreasurySummaryPanel({
  clientUserId,
  hasSyncedData = true,
  onSelectPeriod,
}: Props) {
  const [granularity, setGranularity] = useState<SummaryGranularity>("month");
  const [periods, setPeriods] = useState(12);
  const [data, setData] = useState<TreasurySummaryResponse | null>(null);
  const [forecast, setForecast] = useState<TreasuryForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillRow, setDrillRow] = useState<TreasurySummaryRow | null>(null);
  const [forecastDrill, setForecastDrill] = useState<TreasuryForecastPeriod | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const summaryParams = new URLSearchParams({
      granularity,
      periods: String(periods),
    });
    const [summaryRes, forecastRes] = await Promise.all([
      fetch(`/api/operator/treasury/clients/${clientUserId}/summary?${summaryParams}`),
      fetch(
        `/api/operator/treasury/clients/${clientUserId}/forecast?granularity=${granularity}`
      ),
    ]);

    if (summaryRes.ok) {
      setData((await summaryRes.json()) as TreasurySummaryResponse);
    } else {
      const body = (await summaryRes.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load summary");
      setData(null);
    }

    if (forecastRes.ok) {
      setForecast((await forecastRes.json()) as TreasuryForecastResponse);
    } else {
      setForecast(null);
    }

    setLoading(false);
  }, [clientUserId, granularity, periods]);

  useEffect(() => {
    void load();
  }, [load]);

  function setGranularityWithDefault(g: SummaryGranularity) {
    const def = GRANULARITIES.find((x) => x.id === g)?.defaultPeriods ?? 12;
    setGranularity(g);
    setPeriods(def);
  }

  const rows = data?.rows ?? [];
  const otherRows = data?.other_rows ?? [];
  const currency = data?.primary_currency ?? forecast?.currency ?? "USD";

  const chartBars = useMemo((): ChartBar[] => {
    const history = [...rows]
      .sort((a, b) => a.period_start.localeCompare(b.period_start))
      .map(
        (r): ChartBar => ({
          kind: "history",
          period_start: r.period_start,
          net: r.net,
        })
      );
    const fc = (forecast?.periods ?? []).map(
      (p): ChartBar => ({
        kind: "forecast",
        period_start: p.period_start,
        net: p.net,
        closing: p.closing,
      })
    );
    return [...history, ...fc];
  }, [rows, forecast?.periods]);

  const lowPoint = useMemo(() => {
    const fps = forecast?.periods ?? [];
    if (!fps.length) return null;
    return fps.reduce((min, p) => (p.closing < min.closing ? p : min), fps[0]!);
  }, [forecast?.periods]);

  function handleForecastBarClick(bar: TreasuryForecastPeriod) {
    const full = forecast?.periods.find((p) => p.period_start === bar.period_start);
    if (full) setForecastDrill(full);
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex flex-wrap gap-1">
          {GRANULARITIES.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`btn btn-secondary text-xs ${granularity === g.id ? "on" : ""}`}
              onClick={() => setGranularityWithDefault(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-codex-muted">Last</span>
          <button
            type="button"
            className="btn btn-secondary text-xs px-2"
            disabled={periods <= 1}
            onClick={() => setPeriods((p) => Math.max(1, p - 1))}
            aria-label="Fewer periods"
          >
            −
          </button>
          <span className="tabular-nums font-medium min-w-[2ch] text-center">{periods}</span>
          <button
            type="button"
            className="btn btn-secondary text-xs px-2"
            disabled={periods >= 60}
            onClick={() => setPeriods((p) => Math.min(60, p + 1))}
            aria-label="More periods"
          >
            +
          </button>
          <span className="text-codex-muted">periods</span>
        </label>
        {data ? (
          <span className="text-xs text-codex-muted ml-auto">
            {data.from} – {data.to} · {currency}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="panel-note text-cinnabar" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-codex-muted">Loading summary…</p>
      ) : rows.length === 0 && !error ? (
        <p className="text-sm text-codex-muted">
          {!hasSyncedData
            ? "No transactions synced yet — Sync from bank or Import CSV."
            : "No transactions in this window."}
        </p>
      ) : (
        <>
          <CashFlowChart
            bars={chartBars}
            currency={currency}
            granularity={granularity}
            onHistorySelect={(row) => {
              const full = rows.find((r) => r.period_start === row.period_start);
              setDrillRow(full ?? row);
            }}
            onForecastSelect={handleForecastBarClick}
          />

          {forecast?.insufficient_history ? (
            <p className="text-sm text-codex-muted mt-4">
              Not enough history to project {granularity}ly yet
              {forecast.history_days != null ? ` — ${forecast.history_days} days synced` : ""}.
            </p>
          ) : forecast && forecast.periods.length > 0 ? (
            <>
              {lowPoint ? (
                <div className="fc-stat trough mt-4 p-3 rounded border border-sealed-bone">
                  <p className="fcs-k">Projected low point</p>
                  <p className="fcs-v">
                    {formatTreasuryMoney(lowPoint.closing, forecast.currency)}
                  </p>
                  <p className="fcs-n">
                    {periodLabel(granularity, lowPoint.period_start)}
                  </p>
                </div>
              ) : null}

              <p className="fc-blurb mt-4">
                Projected from your recurring items (rules + labels) plus a{" "}
                {forecast.baseline_periods}-period average of everything else, seeded from
                balances as of {formatTreasuryAsOf(forecast.as_of)}. An estimate, not a
                guarantee — one-off items are not predicted.
              </p>

              <details className="fc-tablewrap mt-4">
                <summary>Forecast detail by period</summary>
                <table className="dtable fc-table w-full text-sm">
                  <thead>
                    <tr>
                      <th className="font-mono text-xs uppercase tracking-wide">Period</th>
                      <th className="font-mono text-xs uppercase tracking-wide">Receipts</th>
                      <th className="font-mono text-xs uppercase tracking-wide">Disbursements</th>
                      <th className="font-mono text-xs uppercase tracking-wide">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.periods.map((p) => (
                      <tr
                        key={p.period_start}
                        className="cursor-pointer hover:bg-sealed-bone/30"
                        onClick={() => setForecastDrill(p)}
                      >
                        <td>{periodLabel(granularity, p.period_start)}</td>
                        <td className="tabular-nums">
                          {formatTreasuryMoney(p.projected_receipts, forecast.currency)}
                        </td>
                        <td className="tabular-nums">
                          {formatTreasuryMoney(p.projected_disbursements, forecast.currency)}
                        </td>
                        <td className="tabular-nums">
                          {formatTreasuryMoney(p.closing, forecast.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : null}

          <table className="dtable w-full text-sm mt-4">
            <thead>
              <tr>
                <th className="font-mono text-xs uppercase tracking-wide">Period</th>
                <th className="font-mono text-xs uppercase tracking-wide">Currency</th>
                <th className="font-mono text-xs uppercase tracking-wide">In</th>
                <th className="font-mono text-xs uppercase tracking-wide">Out</th>
                <th className="font-mono text-xs uppercase tracking-wide">Net</th>
                <th className="font-mono text-xs uppercase tracking-wide">Count</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr
                  key={`${r.period_start}-${r.iso_currency_code}`}
                  className="cursor-pointer hover:bg-sealed-bone/30"
                  onClick={() => setDrillRow(r)}
                >
                  <td>{periodLabel(granularity, r.period_start)}</td>
                  <td>{r.iso_currency_code}</td>
                  <td className="tabular-nums">
                    {formatTreasuryMoney(r.inflow, r.iso_currency_code)}
                  </td>
                  <td className="tabular-nums">
                    {formatTreasuryMoney(r.outflow, r.iso_currency_code)}
                  </td>
                  <td className="tabular-nums">
                    {formatTreasuryMoney(r.net, r.iso_currency_code)}
                  </td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {otherRows.length > 0 ? (
            <details className="mt-4">
              <summary className="text-xs font-mono uppercase tracking-wide text-codex-muted cursor-pointer">
                Other currencies ({otherRows.length} rows)
              </summary>
              <table className="dtable w-full text-sm mt-2">
                <thead>
                  <tr>
                    <th className="font-mono text-xs uppercase tracking-wide">Period</th>
                    <th className="font-mono text-xs uppercase tracking-wide">Currency</th>
                    <th className="font-mono text-xs uppercase tracking-wide">In</th>
                    <th className="font-mono text-xs uppercase tracking-wide">Out</th>
                    <th className="font-mono text-xs uppercase tracking-wide">Net</th>
                    <th className="font-mono text-xs uppercase tracking-wide">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {otherRows.map((r) => (
                    <tr
                      key={`other-${r.period_start}-${r.iso_currency_code}`}
                      className="cursor-pointer hover:bg-sealed-bone/30"
                      onClick={() => setDrillRow(r)}
                    >
                      <td>{periodLabel(granularity, r.period_start)}</td>
                      <td>{r.iso_currency_code}</td>
                      <td className="tabular-nums">
                        {formatTreasuryMoney(r.inflow, r.iso_currency_code)}
                      </td>
                      <td className="tabular-nums">
                        {formatTreasuryMoney(r.outflow, r.iso_currency_code)}
                      </td>
                      <td className="tabular-nums">
                        {formatTreasuryMoney(r.net, r.iso_currency_code)}
                      </td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </>
      )}

      {drillRow ? (
        <TreasuryPeriodDrillModal
          open
          clientUserId={clientUserId}
          bucket={granularity}
          row={drillRow}
          onClose={() => setDrillRow(null)}
          onOpenInTransactions={onSelectPeriod}
        />
      ) : null}

      {forecastDrill && forecast ? (
        <TreasuryForecastDrillModal
          open
          granularity={granularity}
          period={forecastDrill}
          currency={forecast.currency}
          onClose={() => setForecastDrill(null)}
        />
      ) : null}
    </div>
  );
}
