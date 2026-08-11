"use client";

import { useMemo, useState } from "react";
import { CashModelBacktestSection } from "@/components/operator/treasury/cash-model/CashModelBacktestSection";
import { CashModelBucketMapEditor } from "@/components/operator/treasury/cash-model/CashModelBucketMapEditor";
import { CashModelCategoryDivisionCard } from "@/components/operator/treasury/cash-model/CashModelCategoryDivisionCard";
import { CashModelInterventionsCard } from "@/components/operator/treasury/cash-model/CashModelInterventionsCard";
import { CashModelLiquiditySummary } from "@/components/operator/treasury/cash-model/CashModelLiquiditySummary";
import { CashModelRunwayChart } from "@/components/operator/treasury/cash-model/CashModelRunwayChart";
import type { CashModelBucketKey } from "@/lib/treasury/cash-model-types";
import { downloadCashModelReportHtml } from "@/lib/treasury/cash-model-report";
import type { CashModelModelState } from "@/components/operator/treasury/cash-model/useCashModel";

type Props = {
  clientUserId: string;
  accounts: { id: string; name: string }[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
  model: CashModelModelState;
  embedded?: boolean;
  clientName?: string;
};

type SegMode = "base" | "downside" | "selected";

const DOWNSIDE_PRESET = { collections: 0.9, payroll: 1.05, opex: 1.08 };

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function otherOutFromBuckets(
  byBucket: Partial<Record<CashModelBucketKey, number>>
): number {
  return (
    (byBucket.debt_service ?? 0) +
    (byBucket.capex ?? 0) +
    (byBucket.other_out ?? 0) +
    (byBucket.uncategorized_out ?? 0)
  );
}

/**
 * Spec 68 — presentation reshape toward Tim R2 guide.
 * Selected is a visual state: dial edits mutate the active scenario (Base or Downside).
 */
export function TreasuryCashModelPanel({
  clientUserId,
  accounts,
  accountId,
  onAccountIdChange,
  model,
  clientName = "Client",
}: Props) {
  const {
    study,
    result,
    params,
    scenarios,
    scenarioTimelines,
    runwayStatus,
    interventions,
    backtest,
    categorySeries,
    loading,
    computing,
    saving,
    error,
    setSelectedScenarioId,
    setHorizon,
    updateBucketMap,
    updateScenarioFactor,
    updateScenarioThreshold,
    saveStudy,
    saveAsVariant,
  } = model;

  const [segMode, setSegMode] = useState<SegMode>("base");
  const [actionNote, setActionNote] = useState(
    "Downside = collections ×0.90 · payroll ×1.05 · opex ×1.08. Edit any dial and you're in \"Selected\"."
  );

  const base = scenarios?.find((s) => s.id === "base");
  const selected =
    scenarios?.find((s) => s.id === params?.selectedScenarioId) ?? base;
  const selectedSummary = result?.summaries.find(
    (s) => s.scenarioId === params?.selectedScenarioId
  );
  const activeId = selected?.id ?? "base";

  const accountName =
    accounts.find((a) => a.id === accountId)?.name ?? accountId;

  const visualSelected = useMemo(() => {
    if (segMode === "selected") return true;
    if (!selected) return false;
    return selected.source === "user-provided";
  }, [segMode, selected]);

  const pressedSeg: SegMode = visualSelected
    ? "selected"
    : params?.selectedScenarioId === "downside"
      ? "downside"
      : "base";

  function exportReport() {
    if (!result || !params || !scenarios) return;
    downloadCashModelReportHtml({
      clientName,
      accountName,
      generatedAt: new Date().toISOString().slice(0, 10),
      result,
      params,
      scenarios,
      runwayStatus,
      interventions,
      backtest,
    });
  }

  function onSaveAsVariant() {
    const name = window.prompt(
      "Variant name",
      `${study?.name ?? "Cash model"} — variant`
    );
    if (!name) return;
    void saveAsVariant(name);
  }

  function pickSeg(next: SegMode) {
    if (next === "base") {
      setSelectedScenarioId("base");
      setSegMode("base");
      setActionNote(
        "Downside = collections ×0.90 · payroll ×1.05 · opex ×1.08. Edit any dial and you're in \"Selected\"."
      );
      return;
    }
    if (next === "downside") {
      setSelectedScenarioId("downside");
      setSegMode("downside");
      setActionNote(
        "Downside = collections ×0.90 · payroll ×1.05 · opex ×1.08. Edit any dial and you're in \"Selected\"."
      );
      return;
    }
    setSegMode("selected");
  }

  function onDialFactor(bucket: CashModelBucketKey, value: number) {
    updateScenarioFactor(activeId, bucket, value);
    setSegMode("selected");
  }

  function onDialThreshold(value: number) {
    updateScenarioThreshold(activeId, value);
    setSegMode("selected");
  }

  function quickBoostCollections() {
    const cur = selected?.factors.collections ?? 1;
    updateScenarioFactor(activeId, "collections", Math.round(cur * 1.1 * 100) / 100);
    setSegMode("selected");
    setActionNote(
      "+10% collections applied to the dials — a computed what-if; nothing changes in the client's data."
    );
  }

  function quickCutOpex() {
    const cur = selected?.factors.opex ?? 1;
    updateScenarioFactor(activeId, "opex", Math.round(cur * 0.9 * 100) / 100);
    setSegMode("selected");
    setActionNote(
      "−10% opex applied to the dials — a computed what-if; nothing changes in the client's data."
    );
  }

  function quickResetBase() {
    updateScenarioFactor("base", "collections", 1);
    updateScenarioFactor("base", "payroll", 1);
    updateScenarioFactor("base", "opex", 1);
    setSelectedScenarioId("base");
    setSegMode("base");
    setActionNote(
      "Downside = collections ×0.90 · payroll ×1.05 · opex ×1.08. Edit any dial and you're in \"Selected\"."
    );
  }

  if (loading) {
    return <p className="treasury-meta">Loading cash model…</p>;
  }

  if (!study || !params || !scenarios) {
    return (
      <p className="treasury-meta">Select an account to open the cash model.</p>
    );
  }

  const threshold = selected?.minCashThreshold ?? 0;
  const marginAbs = selectedSummary
    ? Math.abs(selectedSummary.thresholdMarginAtLow)
    : 0;
  const belowFloor =
    selectedSummary != null && selectedSummary.thresholdMarginAtLow < 0;

  return (
    <div className="cm-reshape space-y-4">
      <div className="cm-toolbar panel p-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm min-w-[12rem]">
          <span className="treasury-meta">Account</span>
          <select
            className="field-input"
            value={accountId}
            onChange={(e) => onAccountIdChange(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="chip"
          disabled={saving || computing || !result}
          onClick={() => void saveStudy()}
        >
          {saving ? "Saving…" : "Save snapshot"}
        </button>
        <button
          type="button"
          className="chip"
          disabled={saving || computing || !result || result.refused}
          onClick={onSaveAsVariant}
        >
          Save as variant
        </button>
        {computing ? <span className="chip prov-assumed">computing…</span> : null}
      </div>

      {error ? <p className="treasury-meta cm-err">{error}</p> : null}

      {result?.refused ? (
        <div className="panel p-4">
          <p className="sec-title">Cannot project</p>
          <p className="treasury-meta">
            {result.refuseReason ?? "Insufficient history"}
          </p>
        </div>
      ) : null}

      {/* Part A — Assumptions control card */}
      <div className="cm-controls panel p-4 space-y-3">
        <div className="cm-controls-top flex flex-wrap items-end justify-between gap-3">
          <p className="sec-title mb-0">Assumptions</p>
          <label className="cm-dial">
            <span>Horizon (months)</span>
            <input
              type="number"
              min={1}
              max={36}
              className="field-input"
              value={params.horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="seg cm-seg" role="group" aria-label="Scenario">
          <button
            type="button"
            aria-pressed={pressedSeg === "base"}
            onClick={() => pickSeg("base")}
          >
            Base
          </button>
          <button
            type="button"
            aria-pressed={pressedSeg === "downside"}
            onClick={() => pickSeg("downside")}
          >
            Downside
          </button>
          <button
            type="button"
            aria-pressed={pressedSeg === "selected"}
            onClick={() => pickSeg("selected")}
          >
            Selected
          </button>
        </div>

        <div className="cm-dials">
          <label className="cm-dial">
            <span>Collections ×</span>
            <input
              type="number"
              step="0.01"
              min={0.5}
              max={1.5}
              className="field-input"
              value={selected?.factors.collections ?? 1}
              onChange={(e) =>
                onDialFactor("collections", Number(e.target.value))
              }
            />
          </label>
          <label className="cm-dial">
            <span>Payroll ×</span>
            <input
              type="number"
              step="0.01"
              min={0.5}
              max={1.5}
              className="field-input"
              value={selected?.factors.payroll ?? 1}
              onChange={(e) => onDialFactor("payroll", Number(e.target.value))}
            />
          </label>
          <label className="cm-dial">
            <span>Opex ×</span>
            <input
              type="number"
              step="0.01"
              min={0.5}
              max={1.5}
              className="field-input"
              value={selected?.factors.opex ?? 1}
              onChange={(e) => onDialFactor("opex", Number(e.target.value))}
            />
          </label>
          <label className="cm-dial">
            <span>Minimum cash ($)</span>
            <input
              type="number"
              step={1000}
              min={0}
              className="field-input"
              value={threshold}
              onChange={(e) => onDialThreshold(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="cm-actions flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={quickBoostCollections}>
            +10% collections
          </button>
          <button type="button" className="btn ghost" onClick={quickCutOpex}>
            −10% opex
          </button>
          <button type="button" className="btn ghost" onClick={quickResetBase}>
            Reset to Base
          </button>
          <span className="cm-note treasury-meta">{actionNote}</span>
        </div>
        {pressedSeg === "downside" ? (
          <p className="treasury-meta-fine">
            Preset factors · collections ×{DOWNSIDE_PRESET.collections.toFixed(2)} ·
            payroll ×{DOWNSIDE_PRESET.payroll.toFixed(2)} · opex ×
            {DOWNSIDE_PRESET.opex.toFixed(2)}
          </p>
        ) : null}
      </div>

      <CashModelBucketMapEditor
        categorySeries={categorySeries}
        bucketMap={params.bucketMap ?? {}}
        onChange={updateBucketMap}
      />

      {result && !result.refused ? (
        <>
          {/* Parts B–C — Runway headline + chart */}
          <div className="cm-headline-block">
            <p className="cm-headline">
              {selectedSummary?.noBreachInHorizon
                ? `No breach in ${params.horizon}-month horizon`
                : selectedSummary?.runwayMonths != null &&
                    selectedSummary.breachMonth
                  ? <>
                      Runway {selectedSummary.runwayMonths} months ·{" "}
                      <span className="cm-headline-bad">
                        cash floor breached {monthLabel(selectedSummary.breachMonth)}
                      </span>
                    </>
                  : "—"}
            </p>
            <p className="cm-headline-sub">
              {selectedSummary?.minEnding
                ? `Lowest projected cash ${fmtMoney(selectedSummary.minEnding.value)} in ${monthLabel(selectedSummary.minEnding.month)}${
                    belowFloor
                      ? ` · ${fmtMoney(marginAbs)} below the ${fmtMoney(threshold)} floor.`
                      : ` · ${fmtMoney(marginAbs)} above the ${fmtMoney(threshold)} floor.`
                  }`
                : `Opening ${fmtMoney(result.openingBalance)} as of ${result.asOf}`}
            </p>
            <span className="chip prov-assumed">History ending derived</span>
          </div>

          <CashModelRunwayChart
            asOf={result.asOf}
            threshold={threshold}
            selectedTimeline={result.timeline}
            downsideTimeline={scenarioTimelines?.downside}
            selectedScenarioId={params.selectedScenarioId}
            selectedSummary={selectedSummary}
          />

          {/* Part D — Cascade */}
          <div className="cm-cascade panel p-3 overflow-x-auto">
            <p className="sec-title mb-1">The calculation, month by month</p>
            <p className="treasury-meta mb-3">
              Beginning + collections − payroll − opex − other outflows → ending.
              Months below the floor are flagged.
            </p>
            <table className="cm-casc-table w-full text-sm">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Beginning</th>
                  <th className="num">Collections</th>
                  <th className="num">Payroll</th>
                  <th className="num">Opex</th>
                  <th className="num">Other Out</th>
                  <th className="num">Net</th>
                  <th className="num">Ending</th>
                </tr>
              </thead>
              <tbody>
                {result.timeline.map((row, i) => {
                  const beginning = row.ending - row.ncf;
                  const collections =
                    (row.byBucket.collections ?? 0) +
                    (row.byBucket.other_income ?? 0) +
                    (row.byBucket.uncategorized_in ?? 0);
                  const payroll = Math.abs(row.byBucket.payroll ?? 0);
                  const opex = Math.abs(row.byBucket.opex ?? 0);
                  const otherOut = Math.abs(otherOutFromBuckets(row.byBucket));
                  return (
                    <tr
                      key={`${row.month}-${row.kind}-${i}`}
                      className={row.breachFlag ? "cm-casc-breach" : undefined}
                    >
                      <td>
                        {monthLabel(row.month)}
                        <span className="treasury-meta-fine">
                          {" "}
                          · {row.kind}
                          {row.historyDerived ? " · derived" : ""}
                        </span>
                      </td>
                      <td className="num">{fmtMoney(beginning)}</td>
                      <td className="num">{fmtMoney(collections)}</td>
                      <td className="num">{fmtMoney(payroll)}</td>
                      <td className="num">{fmtMoney(opex)}</td>
                      <td className="num">{fmtMoney(otherOut)}</td>
                      <td className="num">{fmtMoney(row.ncf)}</td>
                      <td className="num">{fmtMoney(row.ending)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Part E — Liquidity Summary (KPIs + export; chart owned above) */}
          <CashModelLiquiditySummary
            clientUserId={clientUserId}
            accountId={accountId}
            asOf={result.asOf}
            horizon={params.horizon}
            threshold={threshold}
            openingBalance={result.openingBalance}
            timeline={result.timeline}
            downsideTimeline={scenarioTimelines?.downside}
            selectedScenarioId={params.selectedScenarioId}
            selectedSummary={selectedSummary}
            runwayStatus={runwayStatus}
            interventions={interventions}
            onExport={exportReport}
            showChart={false}
          />

          <CashModelCategoryDivisionCard
            clientUserId={clientUserId}
            accountId={accountId}
            coveragePct={result.coveragePct}
            degradedToTotals={result.degradedToTotals}
            timeline={result.timeline}
          />

          <CashModelInterventionsCard
            interventions={interventions}
            hasBreach={!selectedSummary?.noBreachInHorizon}
          />

          <CashModelBacktestSection rows={backtest} />
        </>
      ) : null}
    </div>
  );
}
