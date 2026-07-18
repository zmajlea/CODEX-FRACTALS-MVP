"use client";

import { useEffect, useMemo, useState } from "react";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";
import type { InputProvenance } from "@/lib/treasury/spend-plan";
import {
  useSpendPlanModel,
  type SpendPlanModelState,
} from "@/components/operator/treasury/spend-plan/useSpendPlanModel";
import { SpendPlanScenarioEditor } from "@/components/operator/treasury/spend-plan/SpendPlanScenarioEditor";
import { AnalyzerSampleSection } from "@/components/operator/treasury/spend-plan/AnalyzerSampleSection";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { monthYm } from "@/lib/treasury/spend-plan";
import { postPickableToDraft } from "@/lib/treasury/post-pickable";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";

type Props = {
  clientUserId: string;
  accountsData: TreasuryAccountsResponse | null;
  /** Controlled account (Analytics shell). */
  accountId?: string;
  onAccountIdChange?: (id: string) => void;
  /** When provided, panel does not own the model hook (shell does). */
  modelState?: SpendPlanModelState;
  label?: string;
  studyId?: string | null;
  onBasketChanged?: () => void;
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function fmt(n: number): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function fmtSigned(n: number): string {
  if (n < 0) return `(${fmt(Math.abs(n))})`;
  return fmt(n);
}

function provenanceClass(p: InputProvenance | string): string {
  if (p === "pulled") return "chip prov-pulled";
  if (p === "user-provided") return "chip prov-user";
  if (p === "assumed") return "chip prov-assumed";
  return "chip prov-adjusted";
}

function SpendPlanPanelBody({
  clientUserId,
  accounts,
  accountId,
  setAccountId,
  model,
  inputs,
  setInputs,
  scenarios,
  setScenarios,
  history,
  excludedMonths,
  toggleExcludedMonth,
  setExcludedReason,
  pulledTtmYoy,
  loading,
  error,
  noHistory,
  insufficientHistory,
  studyId,
  onBasketChanged,
}: {
  clientUserId: string;
  accounts: { id: string; name: string }[];
  accountId: string;
  setAccountId: (id: string) => void;
  model: SpendPlanModelState["model"];
  inputs: SpendPlanModelState["inputs"];
  setInputs: SpendPlanModelState["setInputs"];
  scenarios: SpendPlanModelState["scenarios"];
  setScenarios: SpendPlanModelState["setScenarios"];
  history: SpendPlanModelState["history"];
  excludedMonths: SpendPlanModelState["excludedMonths"];
  toggleExcludedMonth: SpendPlanModelState["toggleExcludedMonth"];
  setExcludedReason: SpendPlanModelState["setExcludedReason"];
  pulledTtmYoy: number | null;
  loading: boolean;
  error: string | null;
  noHistory: boolean;
  insufficientHistory: boolean;
  studyId?: string | null;
  onBasketChanged?: () => void;
}) {
  const activeScenarios = scenarios ?? model?.scenarios ?? [];
  const hasScenarios = activeScenarios.length > 0;

  const backtestVerdict = useMemo(() => {
    if (!model?.backtest?.length) return null;
    const rows = model.backtest;
    const minC = Math.min(...rows.map((r) => r.cumulative));
    const nd = rows.filter((r) => r.surplus < 0).length;
    const held = minC >= 0;
    return {
      nd,
      minC,
      held,
      text: `${nd} monthly deficit${nd === 1 ? "" : "s"} · min cumulative ${fmtSigned(minC)} · ${held ? "the plan would have held" : "the plan would NOT have held"}`,
    };
  }, [model?.backtest]);

  const bufferLabel = useMemo(() => {
    const inp = model?.inputs.find((i) => i.key === "starting_buffer");
    if (inp) return String(inp.value);
    return "—";
  }, [model?.inputs]);

  const backtestPickable = useMemo((): Pickable | null => {
    if (!model?.backtest?.length || !inputs) return null;
    const startMonth = inputs.backtestStartMonth;
    if (!startMonth || !/^\d{4}-\d{2}/.test(startMonth)) return null;
    const params: Record<string, unknown> = {
      startMonth: startMonth.slice(0, 7),
      base: inputs.base,
      step: inputs.step,
      stepEveryMonths: inputs.stepEveryMonths,
    };
    if (studyId) params.studyId = studyId;
    if (accountId) params.accountId = accountId;
    return {
      kind: "backtest",
      params,
      label: `Backtest from ${startMonth.slice(0, 7)}`,
      sublabel: backtestVerdict?.text,
    };
  }, [model?.backtest, inputs, studyId, accountId, backtestVerdict?.text]);

  async function addPickableToDraft(draftKind: DraftKind, pickable: Pickable) {
    try {
      await postPickableToDraft(clientUserId, draftKind, pickable);
      onBasketChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add to draft");
    }
  }

  function scenarioPickable(scenarioId: string, name: string, ending: number): Pickable | null {
    if (!studyId) return null;
    return {
      kind: "scenario",
      params: { studyId, scenarioId },
      label: name,
      sublabel: `ending ${fmtSigned(ending)}`,
    };
  }

  return (
    <div className="spend-plan-panel space-y-6">
      <div>
        <h2 className="font-head text-2xl mb-1">Analyzer</h2>
        <p className="treasury-meta text-sm">
          Deciding which months are real is the product — exclusions are a view,
          never a deletion.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="treasury-meta">Account</span>
          <select
            className="field-input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {inputs ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="treasury-meta">Base allocation</span>
              <input
                className="field-input w-28"
                type="number"
                value={inputs.base}
                onChange={(e) =>
                  setInputs({ base: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="treasury-meta">Step</span>
              <input
                className="field-input w-24"
                type="number"
                value={inputs.step}
                onChange={(e) =>
                  setInputs({ step: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="treasury-meta">Step every (months)</span>
              <input
                className="field-input w-20"
                type="number"
                min={1}
                value={inputs.stepEveryMonths}
                onChange={(e) =>
                  setInputs({
                    stepEveryMonths: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="treasury-meta">Horizon</span>
              <input
                className="field-input w-20"
                type="number"
                value={inputs.horizon}
                onChange={(e) =>
                  setInputs({ horizon: Number(e.target.value) || 24 })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="treasury-meta">Projection start</span>
              <input
                className="field-input"
                type="month"
                value={inputs.startMonth}
                onChange={(e) => setInputs({ startMonth: e.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-cinnabar" role="alert">
          {error}
        </p>
      ) : null}
      {noHistory ? (
        <p className="treasury-meta text-sm">
          No outflow history for this account yet.
        </p>
      ) : null}
      {insufficientHistory ? (
        <p className="treasury-meta text-sm">
          Fewer than 3 complete months — baselines will be thin.
        </p>
      ) : null}

      {history && model ? (
        <AnalyzerSampleSection
          history={history}
          excludedMonths={excludedMonths}
          l0={Number(model.inputs.find((i) => i.key === "l0")?.value ?? 0)}
          l0WindowMonths={model.l0WindowMonths}
          seasonalIndices={model.seasonalIndices}
          seasonalSampleCounts={model.seasonalSampleCounts}
          ttmYoy={pulledTtmYoy}
          bufferLabel={bufferLabel}
          onToggle={toggleExcludedMonth}
          onReason={setExcludedReason}
          accountId={accountId}
          onPick={addPickableToDraft}
        />
      ) : null}

      {model ? (
        <>
          <div className="panel p-4" style={{ border: "1px solid var(--line)" }}>
            <p className="sec-title mb-3">03 · The projection</p>
            <p className="treasury-meta text-sm mb-3 leading-relaxed">
              {model.methodNote}
            </p>
            <dl className="grid gap-2 sm:grid-cols-2 text-sm mb-4">
              {model.inputs.map((inp) => (
                <div key={inp.key} className="flex justify-between gap-2">
                  <dt className="treasury-meta">{inp.label}</dt>
                  <dd className="flex items-center gap-2 tabular-nums">
                    <span>{String(inp.value)}</span>
                    <span className={provenanceClass(inp.provenance)}>
                      {inp.provenance}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            {model.excludedPartialMonth ? (
              <p className="treasury-meta-fine mt-2">
                Excluded partial month: {model.excludedPartialMonth}
              </p>
            ) : null}
            {model.seasonalityDisabled ? (
              <p className="treasury-meta-fine mt-1">
                Seasonality disabled — fewer than 12 distinct months in history.
              </p>
            ) : null}
            {model.historyRepeatsUnavailable ? (
              <p className="treasury-meta-fine mt-1">
                History repeats unavailable
                {model.historyRepeatsReason
                  ? `: ${model.historyRepeatsReason}`
                  : ""}
                .
              </p>
            ) : null}
          </div>

          <div
            className="panel p-4 overflow-x-auto"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title mb-2">Seasonal indices</p>
            <p className="treasury-meta-fine mb-2">
              n = years in the sample for that calendar month. Excluding a month
              can leave an index on a single observation — that is intentional.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="treasury-meta text-left">
                  {MONTH_NAMES.map((m) => (
                    <th key={m} className="pr-2 pb-1">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="tabular-nums">
                  {MONTH_NAMES.map((_, i) => {
                    const month = i + 1;
                    const idx = model.seasonalIndices[month] ?? 1;
                    const n = model.seasonalSampleCounts?.[month] ?? 0;
                    const missing = model.missingSeasonalMonths?.includes(month);
                    if (model.seasonalityDisabled || missing) {
                      return (
                        <td key={i} className="pr-2">
                          1.00
                          <span className="treasury-meta-fine block">no data</span>
                        </td>
                      );
                    }
                    return (
                      <td key={i} className="pr-2">
                        {idx.toFixed(2)}
                        <span
                          className={`treasury-meta-fine block ${n <= 1 ? "text-[var(--su-neg,#E67E50)]" : ""}`}
                        >
                          (n={n})
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <SpendPlanScenarioEditor
            scenarios={activeScenarios}
            setScenarios={setScenarios}
            pulledTtmYoy={pulledTtmYoy}
          />

          {hasScenarios ? (
            <>
              <div
                className="panel p-4 overflow-x-auto"
                style={{ border: "1px solid var(--line)" }}
              >
                <p className="sec-title mb-2">Scenario results</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="treasury-meta text-left border-b border-[var(--line)]">
                      <th className="pb-2 pr-3">Scenario</th>
                      <th className="pb-2 pr-3">Deficit months</th>
                      <th className="pb-2 pr-3">Min cumulative</th>
                      <th className="pb-2 pr-3">Ending position</th>
                      <th className="pb-2">First cumul &lt; 0</th>
                      {studyId ? (
                        <th className="pb-2 w-10" aria-label="Add to draft" />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {model.scenarioResults.map((s) => {
                      const pick = scenarioPickable(
                        s.scenarioId,
                        s.scenarioName,
                        s.endingPosition
                      );
                      return (
                      <tr
                        key={s.scenarioId}
                        className="border-b border-[var(--line)] tabular-nums"
                      >
                        <td className="py-2 pr-3 font-medium">
                          {s.scenarioName}
                          <span
                            className={`ml-2 ${provenanceClass(
                              model.scenarios.find(
                                (sc) => sc.id === s.scenarioId
                              )?.source ?? "assumed"
                            )}`}
                          >
                            {model.scenarios.find(
                              (sc) => sc.id === s.scenarioId
                            )?.source ?? "assumed"}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{s.deficitMonths}</td>
                        <td className="py-2 pr-3">
                          {fmtSigned(s.minCumulative)}
                        </td>
                        <td className="py-2 pr-3">
                          {fmtSigned(s.endingPosition)}
                        </td>
                        <td className="py-2">{s.firstNegativeMonth ?? "—"}</td>
                        {pick ? (
                          <td className="py-2">
                            <PickButton
                              variant="row"
                              pickable={pick}
                              onPick={addPickableToDraft}
                            />
                          </td>
                        ) : studyId ? (
                          <td />
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div
                className="panel p-4 overflow-x-auto"
                style={{ border: "1px solid var(--line)" }}
              >
                <p className="sec-title mb-2">
                  Projection ({model.scenarios.length} scenarios)
                </p>
                <table className="w-full text-xs sm:text-sm min-w-[800px]">
                  <thead>
                    <tr className="treasury-meta text-left">
                      <th className="pb-2 pr-2">Month</th>
                      <th className="pb-2 pr-2">t</th>
                      <th className="pb-2 pr-2">Alloc</th>
                      <th className="pb-2 pr-2">Idx</th>
                      {model.scenarios.map((sc) => (
                        <th key={sc.id} className="pb-2 pr-2" colSpan={2}>
                          {sc.name} spend / cumul
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.projection.map((row) => (
                      <tr
                        key={row.t}
                        className="border-t border-[var(--line)] tabular-nums"
                      >
                        <td className="py-1 pr-2">{row.month.slice(0, 7)}</td>
                        <td className="py-1 pr-2">{row.t}</td>
                        <td className="py-1 pr-2">{fmt(row.allocation)}</td>
                        <td className="py-1 pr-2">
                          {row.seasonalIndex.toFixed(2)}
                        </td>
                        {model.scenarios.map((sc) => (
                          <td key={sc.id} className="py-1 pr-2" colSpan={2}>
                            {fmt(row.spendByScenario[sc.id] ?? 0)} /{" "}
                            {fmtSigned(row.cumulativeByScenario[sc.id] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="treasury-meta text-sm">
              No scenarios — add one to project.
            </p>
          )}

          <div
            className="panel p-4 overflow-x-auto"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title mb-2 flex flex-wrap items-center gap-3">
              <span>02 · The backtest</span>
              {backtestPickable ? (
                <PickButton
                  variant="header"
                  pickable={backtestPickable}
                  onPick={addPickableToDraft}
                />
              ) : null}
            </p>
            <p className="treasury-meta text-sm mb-3 leading-relaxed">
              No assumptions — allocation vs what actually left the bank. Exclusions
              do not touch this table. <b>The actuals are the actuals.</b>
            </p>
            {inputs ? (
              <div className="flex flex-wrap gap-3 mb-3 items-end">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="treasury-meta">
                    What if the plan had started
                  </span>
                  <select
                    className="field-input"
                    value={inputs.backtestStartMonth}
                    onChange={(e) =>
                      setInputs({ backtestStartMonth: e.target.value })
                    }
                  >
                    {(history?.completeMonths ?? []).map((m) => (
                      <option key={m} value={monthYm(m)}>
                        {monthYm(m)}
                      </option>
                    ))}
                  </select>
                </label>
                {backtestVerdict ? (
                  <p
                    className={`text-sm font-medium ${backtestVerdict.held ? "text-[var(--su-pos)]" : "text-[var(--su-neg)]"}`}
                  >
                    {backtestVerdict.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            {model.backtest && model.backtest.length > 0 ? (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="treasury-meta text-left">
                      <th className="pb-2 pr-3">Month</th>
                      <th className="pb-2 pr-3">t</th>
                      <th className="pb-2 pr-3">Allocation</th>
                      <th className="pb-2 pr-3">Actual debits</th>
                      <th className="pb-2 pr-3">Surplus/(Deficit)</th>
                      <th className="pb-2">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.backtest.map((row) => (
                      <tr
                        key={row.t}
                        className="border-t border-[var(--line)] tabular-nums"
                      >
                        <td className="py-1 pr-3">{row.month.slice(0, 7)}</td>
                        <td className="py-1 pr-3">{row.t}</td>
                        <td className="py-1 pr-3">{fmt(row.allocation)}</td>
                        <td className="py-1 pr-3">{fmt(row.actualDebits)}</td>
                        <td className="py-1 pr-3">{fmtSigned(row.surplus)}</td>
                        <td className="py-1">{fmtSigned(row.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="treasury-meta-fine mt-2">
                  A single negative month is not an alert; the cumulative going
                  negative is. Deficits in backtest:{" "}
                  {model.backtestNegativeMonths ?? 0}.
                </p>
              </>
            ) : (
              <p className="treasury-meta text-sm">No backtest months available.</p>
            )}
          </div>
        </>
      ) : loading ? (
        <p className="treasury-meta">Loading Analyzer…</p>
      ) : null}
    </div>
  );
}

export function TreasurySpendPlanPanel({
  clientUserId,
  accountsData,
  accountId: controlledAccountId,
  onAccountIdChange,
  modelState,
  label,
  studyId,
  onBasketChanged,
}: Props) {
  const accounts = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    for (const inst of accountsData?.institutions ?? []) {
      for (const a of inst.accounts) {
        list.push({
          id: a.account_id,
          name: a.name ?? a.account_id,
        });
      }
    }
    return list;
  }, [accountsData]);

  const [internalAccountId, setInternalAccountId] = useState("");
  const accountId = controlledAccountId ?? internalAccountId;
  const setAccountId = onAccountIdChange ?? setInternalAccountId;

  useEffect(() => {
    if (!accountId && accounts[0]) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId, setAccountId]);

  const internalModel = useSpendPlanModel(
    clientUserId,
    modelState ? "" : accountId,
    label
  );
  const state = modelState ?? internalModel;

  return (
    <SpendPlanPanelBody
      clientUserId={clientUserId}
      accounts={accounts}
      accountId={accountId}
      setAccountId={setAccountId}
      model={state.model}
      inputs={state.inputs}
      setInputs={state.setInputs}
      scenarios={state.scenarios}
      setScenarios={state.setScenarios}
      history={state.history}
      excludedMonths={state.excludedMonths}
      toggleExcludedMonth={state.toggleExcludedMonth}
      setExcludedReason={state.setExcludedReason}
      pulledTtmYoy={state.currentSnapshot?.ttmYoy ?? null}
      loading={state.loading}
      error={state.error}
      noHistory={state.noHistory}
      insufficientHistory={state.insufficientHistory}
      studyId={studyId}
      onBasketChanged={onBasketChanged}
    />
  );
}
