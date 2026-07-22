"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TreasuryForecastDrillModal } from "@/components/operator/treasury/TreasuryForecastDrillModal";
import { TreasuryPeriodDrillModal } from "@/components/operator/treasury/TreasuryPeriodDrillModal";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { formatTreasuryAsOf, formatTreasuryMoney, TREASURY_DISPLAY_LOCALE } from "@/lib/treasury/format";
import {
  listPeriodStarts,
  periodEnd,
  periodLabel,
  subtractDays,
  subtractMonths,
  todayIso,
} from "@/lib/treasury/period-bounds";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import {
  FORECAST_BOUNDARY_CAVEAT,
  FORECAST_ENGINE_LABEL,
  FORECAST_METHOD_NOTE,
} from "@/lib/treasury/forecast-disclosure";
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
  /** Spec 46 Stage 7 — inside Analytics subtabs (Ana forecast shape). */
  embedded?: boolean;
  /** Spec 50 — shared account scope with Analyzer. */
  accounts?: { id: string; name: string }[];
  accountId?: string;
  onAccountIdChange?: (id: string) => void;
  onSelectPeriod?: (bucket: SummaryBucket, periodStart: string) => void;
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
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

/** Ana: "Jan to Dec 2026" — range for the This view line. */
function formatViewRange(
  granularity: SummaryGranularity,
  first: string,
  last: string
): string {
  const a = new Date(first + "T12:00:00Z");
  const b = new Date(last + "T12:00:00Z");
  if (granularity === "month") {
    const ma = a.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const mb = b.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const ya = a.getUTCFullYear();
    const yb = b.getUTCFullYear();
    if (ya === yb) return `${ma} to ${mb} ${ya}`;
    return `${ma} ${ya} to ${mb} ${yb}`;
  }
  const short = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const full = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${short(a)} to ${short(b)}, ${a.getUTCFullYear()}`;
  }
  return `${full(a)} to ${full(b)}`;
}

function sinceForDefaultPeriods(
  granularity: SummaryGranularity,
  defaultPeriods: number
): string {
  const today = todayIso();
  if (granularity === "day") return subtractDays(today, defaultPeriods - 1);
  if (granularity === "week") return subtractDays(today, defaultPeriods * 7 - 1);
  return subtractMonths(today, defaultPeriods);
}

function CashFlowChart({
  bars,
  currency,
  granularity,
  dividerLabel = "Latest data",
  onHistorySelect,
  onForecastSelect,
}: {
  bars: ChartBar[];
  currency: string;
  granularity: SummaryGranularity;
  dividerLabel?: string;
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
              {dividerLabel}
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
  embedded = false,
  accounts = [],
  accountId = "",
  onAccountIdChange,
  onSelectPeriod,
  onPick,
}: Props) {
  const [granularity, setGranularity] = useState<SummaryGranularity>("month");
  const [since, setSince] = useState(() => subtractMonths(todayIso(), 12));
  const [data, setData] = useState<TreasurySummaryResponse | null>(null);
  const [forecast, setForecast] = useState<TreasuryForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillRow, setDrillRow] = useState<TreasurySummaryRow | null>(null);
  const [forecastDrill, setForecastDrill] = useState<TreasuryForecastPeriod | null>(null);

  const accountName =
    accounts.find((a) => a.id === accountId)?.name ??
    forecast?.account_name ??
    accountId;

  /** Operator `since` always wins — periods derive from the window, never clamped to defaultPeriods. */
  const periods = useMemo(() => {
    const starts = listPeriodStarts(granularity, since, todayIso());
    return Math.min(60, Math.max(1, starts.length || 1));
  }, [granularity, since]);

  function periodPickable(row: TreasurySummaryRow): Pickable {
    const from = row.period_start;
    const to = periodEnd(granularity, row.period_start);
    return {
      kind: "summary_period",
      params: {
        granularity,
        from,
        to,
      },
      label: `${periodLabel(granularity, row.period_start)} · ${formatTreasuryMoney(row.net, row.iso_currency_code)}`,
      sublabel: `${row.count} tx`,
    };
  }

  function rangePickable(): Pickable | null {
    const from = data?.from ?? since;
    const to = data?.to ?? todayIso();
    if (!from || !to) return null;
    return {
      kind: "summary_range",
      params: { granularity, from, to },
      label: `Summary ${from} → ${to}`,
      sublabel: `${granularity} · ${periods} period${periods === 1 ? "" : "s"}`,
    };
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Wait for shared account default before calling (avoids 400 flash).
    if (accounts.length > 0 && !accountId) {
      setLoading(false);
      return;
    }
    const summaryParams = new URLSearchParams({
      granularity,
      periods: String(periods),
    });
    // Spec 50: accountId required only when the client has accounts.
    const forecastQs = new URLSearchParams({ granularity });
    if (accounts.length > 0 && accountId) {
      summaryParams.set("account_id", accountId);
      forecastQs.set("accountId", accountId);
    }
    const [summaryRes, forecastRes] = await Promise.all([
      fetch(`/api/operator/treasury/clients/${clientUserId}/summary?${summaryParams}`),
      fetch(
        `/api/operator/treasury/clients/${clientUserId}/forecast?${forecastQs}`
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
      if (forecastRes.status >= 400) {
        const body = (await forecastRes.json().catch(() => ({}))) as {
          error?: string;
        };
        if (body.error) setError(body.error);
      }
    }

    setLoading(false);
  }, [clientUserId, granularity, periods, accounts.length, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  function setGranularityKeepSince(g: SummaryGranularity) {
    const meta = GRANULARITIES.find((x) => x.id === g);
    setGranularity(g);
    if (embedded && meta) {
      setSince(sinceForDefaultPeriods(g, meta.defaultPeriods));
    }
  }

  const rows = data?.rows ?? [];
  const otherRows = data?.other_rows ?? [];
  const currency = data?.primary_currency ?? forecast?.currency ?? "USD";
  const granWord =
    granularity === "day" ? "daily" : granularity === "week" ? "weekly" : "monthly";

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
    return [...history, ...fc].sort((a, b) =>
      a.period_start.localeCompare(b.period_start)
    );
  }, [rows, forecast?.periods]);

  const lowPoint = useMemo(() => {
    const fps = forecast?.periods ?? [];
    if (!fps.length) return null;
    return fps.reduce((min, p) => (p.closing < min.closing ? p : min), fps[0]!);
  }, [forecast?.periods]);

  function forecastPickable(): Pickable | null {
    if (!forecast || forecast.refuse_projection || forecast.insufficient_history) {
      return null;
    }
    if (!forecast.periods.length) return null;
    if (!accountId) return null;
    const asOf =
      forecast.as_of?.slice(0, 10) ??
      forecast.data_span?.last ??
      todayIso();
    const scopeLabel = accountName || accountId;
    const label = lowPoint
      ? `Projected low point, ${periodLabel(granularity, lowPoint.period_start)} · ${scopeLabel}`
      : `Forecast as of ${asOf} · ${scopeLabel}`;
    const sublabel = lowPoint
      ? formatTreasuryMoney(lowPoint.closing, forecast.currency)
      : `${forecast.periods.length} periods`;
    return {
      kind: "forecast",
      params: {
        granularity,
        asOf,
        projected: true,
        accountId,
        accountName: scopeLabel,
        ...(lowPoint
          ? {
              lowPointPeriod: lowPoint.period_start,
              lowPointClosing: lowPoint.closing,
            }
          : {}),
      },
      snap: {
        projected: true,
        caveat: FORECAST_BOUNDARY_CAVEAT,
        engineLabel: `${FORECAST_ENGINE_LABEL} · for account ${scopeLabel}`,
        label,
        sublabel,
        accountName: scopeLabel,
        ...(lowPoint ? { amount: lowPoint.closing, direction: "in" as const } : {}),
      },
      label,
      sublabel,
    };
  }

  function handleForecastBarClick(bar: TreasuryForecastPeriod) {
    const full = forecast?.periods.find((p) => p.period_start === bar.period_start);
    if (full) setForecastDrill(full);
  }

  const dataSpanLine = data?.data_span
    ? `Data through ${data.data_span.last}. From ${data.data_span.first ?? data.from}. ${currency}.`
    : data
      ? `${data.from} – ${data.to} · ${currency}`
      : null;

  /** Ana shape: "This view: Jan to Dec 2026, 12 monthly periods." — history window, not forecast-only. */
  const thisViewLine = useMemo(() => {
    const sorted = [...rows].sort((a, b) =>
      a.period_start.localeCompare(b.period_start)
    );
    const count = sorted.length > 0 ? sorted.length : periods;
    const periodPhrase = `${count} ${granWord} period${count === 1 ? "" : "s"}`;
    if (sorted.length > 0) {
      const first = sorted[0]!.period_start;
      const last = sorted[sorted.length - 1]!.period_start;
      return `${formatViewRange(granularity, first, last)}, ${periodPhrase}`;
    }
    return periodPhrase;
  }, [rows, periods, granWord, granularity]);

  return (
    <div className={embedded ? undefined : "panel p-4"}>
      {embedded ? (
        <>
          <p className="engine-label">
            {FORECAST_ENGINE_LABEL}
            {accountName ? ` · for account ${accountName}` : ""}
            {dataSpanLine ? `. ${dataSpanLine}` : ""}
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div
              className="seg"
              role="group"
              aria-label="Granularity"
              style={{ marginBottom: 0 }}
            >
              {GRANULARITIES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={granularity === g.id}
                  onClick={() => setGranularityKeepSince(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {accounts.length > 0 && onAccountIdChange ? (
              <label
                className="flex items-center gap-2 text-sm"
                style={{ margin: 0 }}
              >
                <span className="treasury-meta">Account</span>
                <select
                  className="field-input"
                  value={accountId}
                  onChange={(e) => onAccountIdChange(e.target.value)}
                  aria-label="Forecast account"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="adv-body" style={{ margin: 0, padding: "6px 12px" }}>
              <label
                className="meta"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  margin: 0,
                }}
              >
                Since
                <input
                  type="date"
                  value={since}
                  max={todayIso()}
                  aria-label="History window start"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setSince(v);
                  }}
                />
              </label>
            </div>
            {rangePickable() && onPick ? (
              <div className="lp-act" style={{ margin: 0 }}>
                <PickButton
                  variant="header"
                  pickable={rangePickable()!}
                  onPick={onPick}
                />
              </div>
            ) : null}
          </div>
          <p className="meta" style={{ margin: "0 0 6px" }}>
            This view: {thisViewLine}.
          </p>
        </>
      ) : (
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <div className="lens-row">
            {GRANULARITIES.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`lens-btn${granularity === g.id ? " on" : ""}`}
                onClick={() => setGranularityKeepSince(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-codex-muted font-mono text-[10px] uppercase tracking-wide">
              Since
            </span>
            <input
              type="date"
              className="field-input text-sm"
              value={since}
              max={todayIso()}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setSince(v);
              }}
            />
            <span className="text-xs text-codex-muted">
              since {since} · {periods} {granWord} period{periods === 1 ? "" : "s"}
            </span>
          </label>
          {rangePickable() && onPick ? (
            <PickButton variant="header" pickable={rangePickable()!} onPick={onPick} />
          ) : null}
          {data?.data_span ? (
            <span className="text-xs text-codex-muted ml-auto">
              Data through {data.data_span.last}
              {data.data_span.first ? ` · from ${data.data_span.first}` : ""} · {currency}
            </span>
          ) : data ? (
            <span className="text-xs text-codex-muted ml-auto">
              {data.from} – {data.to} · {currency}
            </span>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="panel-note text-cinnabar" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-codex-muted">Loading summary…</p>
      ) : rows.length === 0 && !error ? (
        <p className="text-sm text-codex-muted" role="status">
          {embedded
            ? "Import a book to see this"
            : !hasSyncedData
              ? "No transactions synced yet — Sync from bank or Import CSV."
              : "No transactions in this window."}
        </p>
      ) : (
        <>
          <CashFlowChart
            bars={chartBars}
            currency={currency}
            granularity={granularity}
            dividerLabel={
              forecast?.data_span?.last
                ? `Latest data · ${forecast.data_span.last.slice(5).replace("-", "/")}`
                : "Latest data"
            }
            onHistorySelect={(row) => {
              const full = rows.find((r) => r.period_start === row.period_start);
              setDrillRow(full ?? row);
            }}
            onForecastSelect={handleForecastBarClick}
          />

          {embedded ? (
            <div className="fc-legend">
              <span>
                <span className="sw act" /> Actual, what happened
              </span>
              <span>
                <span className="sw pr" /> Projected, an estimate
              </span>
            </div>
          ) : null}

          {forecast?.refuse_projection ? (
            <p className="text-sm text-codex-muted mt-4" role="status">
              {forecast.refuse_reason ??
                `Cannot project — seed window is outside the data span${
                  forecast.data_span?.last
                    ? ` (data through ${forecast.data_span.last})`
                    : ""
                }.`}
            </p>
          ) : forecast?.insufficient_history ? (
            <p className="text-sm text-codex-muted mt-4" role="status">
              {embedded && (forecast.history_days == null || forecast.history_days === 0)
                ? "Import a book to see this"
                : `Not enough history to project ${granularity}ly yet${
                    forecast.history_days != null
                      ? ` — ${forecast.history_days} days synced`
                      : ""
                  }.`}
            </p>
          ) : forecast && forecast.periods.length > 0 ? (
            <>
              {lowPoint ? (
                embedded ? (
                  <div className="lowpoint">
                    <div className="lp-l">
                      Projected low point, monthly
                      {accountName ? ` · ${accountName}` : ""}
                    </div>
                    <div className="lp-n num">
                      {formatTreasuryMoney(lowPoint.closing, forecast.currency)}
                    </div>
                    <div className="lp-m">
                      {periodLabel(granularity, lowPoint.period_start)}, the lowest
                      monthly position across the projection.
                    </div>
                    <div className="caveat" style={{ margin: "12px 0 0" }}>
                      <span>
                        Projected from your recurring items (rules and labels) plus
                        a {forecast.baseline_periods}-period average of everything
                        else
                        {forecast.data_span
                          ? `, using data through ${forecast.data_span.last}`
                          : forecast.as_of
                            ? `, seeded from balances as of ${formatTreasuryAsOf(forecast.as_of)}`
                            : ""}
                        . {FORECAST_METHOD_NOTE}
                      </span>
                    </div>
                    <div className="caveat" style={{ margin: "10px 0 0" }}>
                      <span>{FORECAST_BOUNDARY_CAVEAT}</span>
                    </div>
                    {forecastPickable() && onPick ? (
                      <div className="lp-act">
                        <PickButton
                          variant="header"
                          pickable={forecastPickable()!}
                          onPick={onPick}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="fc-stat trough mt-4 p-3 rounded border border-sealed-bone flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="fcs-k">Projected low point</p>
                      <p className="fcs-v">
                        {formatTreasuryMoney(lowPoint.closing, forecast.currency)}
                      </p>
                      <p className="fcs-n">
                        {periodLabel(granularity, lowPoint.period_start)}
                      </p>
                    </div>
                    {forecastPickable() && onPick ? (
                      <PickButton
                        variant="header"
                        pickable={forecastPickable()!}
                        onPick={onPick}
                      />
                    ) : null}
                  </div>
                )
              ) : null}

              {!embedded ? (
                <p className="fc-blurb mt-4">
                  Projected from your recurring items (rules + labels) plus a{" "}
                  {forecast.baseline_periods}-period average of everything else
                  {forecast.data_span
                    ? `, using data through ${forecast.data_span.last}`
                    : forecast.as_of
                      ? `, seeded from balances as of ${formatTreasuryAsOf(forecast.as_of)}`
                      : ""}
                  . {FORECAST_METHOD_NOTE}
                </p>
              ) : null}

              {embedded ? (
                <>
                  <div className="rec-sec">
                    <h2 className="rs-h">Forecast detail by period</h2>
                    <p className="rs-note">
                      The periods behind the headline, so the projection is
                      inspectable, not just asserted.
                    </p>
                  </div>
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Currency</th>
                        <th style={{ textAlign: "right" }}>In</th>
                        <th style={{ textAlign: "right" }}>Out</th>
                        <th style={{ textAlign: "right" }}>Net</th>
                        <th style={{ textAlign: "right" }}>Closing</th>
                        <th>Action</th>
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
                          <td className="src">{forecast.currency}</td>
                          <td className="amtcell">
                            <span className="amt in num">
                              {formatTreasuryMoney(p.projected_receipts, forecast.currency)}
                            </span>
                          </td>
                          <td className="amtcell">
                            <span className="amt out num">
                              {formatTreasuryMoney(
                                p.projected_disbursements,
                                forecast.currency
                              )}
                            </span>
                          </td>
                          <td className="amtcell num">
                            {formatTreasuryMoney(p.net, forecast.currency)}
                          </td>
                          <td className="amtcell num">
                            {formatTreasuryMoney(p.closing, forecast.currency)}
                          </td>
                          <td className="row-act">
                            <div className="row-act-in">
                              {onPick ? (
                                <PickButton
                                  variant="row"
                                  pickable={{
                                    kind: "figure",
                                    params: {
                                      metric: "forecast_closing",
                                      from: p.period_start,
                                      to: periodEnd(granularity, p.period_start),
                                      granularity,
                                    },
                                    label: periodLabel(granularity, p.period_start),
                                    sublabel: formatTreasuryMoney(
                                      p.closing,
                                      forecast.currency
                                    ),
                                  }}
                                  onPick={onPick}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <details className="fc-tablewrap mt-4">
                  <summary>Forecast detail by period</summary>
                  <table className="dtable fc-table w-full text-sm">
                    <thead>
                      <tr>
                        <th className="font-mono text-xs uppercase tracking-wide">
                          Period
                        </th>
                        <th className="font-mono text-xs uppercase tracking-wide">
                          Receipts
                        </th>
                        <th className="font-mono text-xs uppercase tracking-wide">
                          Disbursements
                        </th>
                        <th className="font-mono text-xs uppercase tracking-wide">
                          Closing
                        </th>
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
                            {formatTreasuryMoney(
                              p.projected_receipts,
                              forecast.currency
                            )}
                          </td>
                          <td className="tabular-nums">
                            {formatTreasuryMoney(
                              p.projected_disbursements,
                              forecast.currency
                            )}
                          </td>
                          <td className="tabular-nums">
                            {formatTreasuryMoney(p.closing, forecast.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </>
          ) : null}

          {!embedded ? (
          <table className="dtable w-full text-sm mt-4">
            <thead>
              <tr>
                <th className="font-mono text-xs uppercase tracking-wide">Period</th>
                <th className="font-mono text-xs uppercase tracking-wide">Currency</th>
                <th className="font-mono text-xs uppercase tracking-wide">In</th>
                <th className="font-mono text-xs uppercase tracking-wide">Out</th>
                <th className="font-mono text-xs uppercase tracking-wide">Net</th>
                <th className="font-mono text-xs uppercase tracking-wide">Count</th>
                <th className="font-mono text-xs uppercase tracking-wide" aria-label="Add to draft" />
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr
                  key={`${r.period_start}-${r.iso_currency_code}`}
                  className="cursor-pointer hover:bg-sealed-bone/30 group"
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
                  <td
                    className="w-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <PickButton
                      variant="row"
                      pickable={periodPickable(r)}
                      onPick={onPick!}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          ) : null}

          {!embedded && otherRows.length > 0 ? (
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
