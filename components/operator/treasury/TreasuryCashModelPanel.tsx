"use client";

import { CashModelBacktestSection } from "@/components/operator/treasury/cash-model/CashModelBacktestSection";
import { CashModelCommittedFlowsCard } from "@/components/operator/treasury/cash-model/CashModelCommittedFlowsCard";
import { CashModelCoverageMeter } from "@/components/operator/treasury/cash-model/CashModelCoverageMeter";
import { CashModelExplainChart } from "@/components/operator/treasury/cash-model/CashModelExplainChart";
import { CashModelInterventionsCard } from "@/components/operator/treasury/cash-model/CashModelInterventionsCard";
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

const ASSUMPTION_ROWS: Array<{
  key: CashModelBucketKey | "threshold";
  label: string;
  isThreshold?: boolean;
}> = [
  { key: "collections", label: "Collection factor" },
  { key: "payroll", label: "Payroll factor" },
  { key: "opex", label: "Other opex factor" },
  { key: "threshold", label: "Minimum cash threshold", isThreshold: true },
];

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPctFactor(n: number): string {
  return n.toFixed(2);
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function provClass(source: "assumed" | "user-provided"): string {
  return source === "user-provided" ? "prov-user-provided" : "prov-assumed";
}

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
    loading,
    computing,
    saving,
    error,
    setSelectedScenarioId,
    updateScenarioFactor,
    updateScenarioThreshold,
    saveStudy,
  } = model;

  const base = scenarios?.find((s) => s.id === "base");
  const downside = scenarios?.find((s) => s.id === "downside");
  const selected =
    scenarios?.find((s) => s.id === params?.selectedScenarioId) ?? base;
  const selectedSummary = result?.summaries.find(
    (s) => s.scenarioId === params?.selectedScenarioId
  );

  const accountName =
    accounts.find((a) => a.id === accountId)?.name ?? accountId;

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

  if (loading) {
    return <p className="treasury-meta">Loading cash model…</p>;
  }

  if (!study || !params || !scenarios) {
    return <p className="treasury-meta">Select an account to open the cash model.</p>;
  }

  return (
    <div className="space-y-4">
      <div
        className="panel p-3 flex flex-wrap items-end gap-3"
        style={{ border: "1px solid var(--line)" }}
      >
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
          disabled={!result || result.refused}
          onClick={exportReport}
        >
          Export report
        </button>
        {computing ? <span className="chip prov-assumed">computing…</span> : null}
      </div>

      {error ? <p className="treasury-meta text-[var(--cinnabar,#E67E50)]">{error}</p> : null}

      {result?.refused ? (
        <div className="panel p-4" style={{ border: "1px solid var(--line)" }}>
          <p className="sec-title">Cannot project</p>
          <p className="treasury-meta">{result.refuseReason ?? "Insufficient history"}</p>
        </div>
      ) : null}

      {result && !result.refused ? (
        <>
          <div
            className="panel p-4 space-y-2"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title">Runway headline</p>
            <p className="text-lg font-medium">
              {selectedSummary?.noBreachInHorizon
                ? `No breach in ${params.horizon}-month horizon`
                : selectedSummary?.breachMonth
                  ? `Breach · ${monthLabel(selectedSummary.breachMonth)}${
                      selectedSummary.runwayMonths != null
                        ? ` (${selectedSummary.runwayMonths} months)`
                        : ""
                    }`
                  : "—"}
            </p>
            <p className="treasury-meta">
              Opening {fmtMoney(result.openingBalance)} as of {result.asOf}
              {selectedSummary
                ? ` · low ${fmtMoney(selectedSummary.minEnding.value)} (${monthLabel(selectedSummary.minEnding.month)})`
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="chip prov-pulled">
                Coverage {Math.round(result.coveragePct * 100)}%
              </span>
              {result.degradedToTotals ? (
                <span className="chip prov-assumed">Totals-only (low coverage)</span>
              ) : null}
              <span className="chip prov-assumed">History ending derived</span>
            </div>
          </div>

          <CashModelRunwayChart
            asOf={result.asOf}
            threshold={selected?.minCashThreshold ?? 0}
            selectedTimeline={result.timeline}
            downsideTimeline={scenarioTimelines?.downside}
            selectedScenarioId={params.selectedScenarioId}
            selectedSummary={selectedSummary}
          />

          <CashModelCoverageMeter
            coveragePct={result.coveragePct}
            degradedToTotals={result.degradedToTotals}
            timeline={result.timeline}
          />

          <CashModelExplainChart timeline={result.timeline} />

          <CashModelCommittedFlowsCard
            clientUserId={clientUserId}
            accountId={accountId}
          />

          <CashModelInterventionsCard
            interventions={interventions}
            hasBreach={!selectedSummary?.noBreachInHorizon}
          />

          <CashModelBacktestSection rows={backtest} />

          <div className="panel p-3 overflow-x-auto" style={{ border: "1px solid var(--line)" }}>
            <p className="sec-title mb-2">Assumptions</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="treasury-meta text-left">
                  <th className="py-1 pr-3">Input</th>
                  <th className="py-1 pr-3">Base</th>
                  <th className="py-1 pr-3">Downside</th>
                  <th className="py-1">
                    Selected
                    <select
                      className="field-input ml-2 inline-block w-auto text-xs"
                      value={params.selectedScenarioId}
                      onChange={(e) => setSelectedScenarioId(e.target.value)}
                    >
                      {scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ASSUMPTION_ROWS.map((row) => (
                  <tr key={row.key} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="py-2 pr-3">
                      {row.isThreshold ? (
                        <input
                          type="number"
                          className={`field-input w-28 ${base ? provClass(base.source) : ""}`}
                          value={base?.minCashThreshold ?? 0}
                          onChange={(e) =>
                            updateScenarioThreshold("base", Number(e.target.value))
                          }
                        />
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          className={`field-input w-20 ${base ? provClass(base.source) : ""}`}
                          value={base?.factors[row.key as CashModelBucketKey] ?? 1}
                          onChange={(e) =>
                            updateScenarioFactor(
                              "base",
                              row.key as CashModelBucketKey,
                              Number(e.target.value)
                            )
                          }
                        />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {row.isThreshold ? (
                        <input
                          type="number"
                          className={`field-input w-28 ${downside ? provClass(downside.source) : ""}`}
                          value={downside?.minCashThreshold ?? 0}
                          onChange={(e) =>
                            updateScenarioThreshold("downside", Number(e.target.value))
                          }
                        />
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          className={`field-input w-20 ${downside ? provClass(downside.source) : ""}`}
                          value={downside?.factors[row.key as CashModelBucketKey] ?? 1}
                          onChange={(e) =>
                            updateScenarioFactor(
                              "downside",
                              row.key as CashModelBucketKey,
                              Number(e.target.value)
                            )
                          }
                        />
                      )}
                    </td>
                    <td className="py-2">
                      {selected ? (
                        row.isThreshold ? (
                          <span className={`chip ${provClass(selected.source)}`}>
                            {fmtMoney(selected.minCashThreshold)}
                          </span>
                        ) : (
                          <span className={`chip ${provClass(selected.source)}`}>
                            {fmtPctFactor(
                              selected.factors[row.key as CashModelBucketKey] ?? 1
                            )}
                          </span>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel p-3 overflow-x-auto" style={{ border: "1px solid var(--line)" }}>
            <p className="sec-title mb-2">Cascade</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="treasury-meta text-left">
                  <th className="py-1 pr-2">Month</th>
                  <th className="py-1 pr-2">Kind</th>
                  <th className="py-1 pr-2 text-right">NCF</th>
                  <th className="py-1 pr-2 text-right">Ending</th>
                  <th className="py-1 text-right">Breach</th>
                </tr>
              </thead>
              <tbody>
                {result.timeline.map((row) => (
                  <tr key={`${row.month}-${row.kind}`} className="border-t border-[var(--line)]">
                    <td className="py-1 pr-2">{monthLabel(row.month)}</td>
                    <td className="py-1 pr-2 treasury-meta">
                      {row.kind}
                      {row.historyDerived ? " · derived" : ""}
                    </td>
                    <td className="py-1 pr-2 text-right">{fmtMoney(row.ncf)}</td>
                    <td className="py-1 pr-2 text-right">{fmtMoney(row.ending)}</td>
                    <td className="py-1 text-right">{row.breachFlag ? "yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
