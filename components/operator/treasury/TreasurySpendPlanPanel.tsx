"use client";

import { useEffect, useMemo, useState } from "react";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";
import type { InputProvenance } from "@/lib/treasury/spend-plan";
import {
  useSpendPlanModel,
  type SpendPlanModelState,
  type SpendPlanParamDirty,
} from "@/components/operator/treasury/spend-plan/useSpendPlanModel";
import { SpendPlanScenarioEditor } from "@/components/operator/treasury/spend-plan/SpendPlanScenarioEditor";
import { AnalyzerSampleSection } from "@/components/operator/treasury/spend-plan/AnalyzerSampleSection";
import { AnalyzerAnaControls } from "@/components/operator/treasury/spend-plan/AnalyzerAnaControls";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { monthYm } from "@/lib/treasury/spend-plan";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import {
  ANALYZER_ENGINE_LABEL,
  BACKTEST_START_MONTH_CAVEAT,
} from "@/lib/treasury/forecast-disclosure";

type Props = {
  clientUserId: string;
  accountsData: TreasuryAccountsResponse | null;
  accountId?: string;
  onAccountIdChange?: (id: string) => void;
  modelState?: SpendPlanModelState;
  label?: string;
  studyId?: string | null;
  /** Spec 46 Stage 7 / 46d — Ana Analyzer subtab shape. */
  embedded?: boolean;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  /** Optional client display name for verdict copy. */
  clientName?: string;
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

function fmtMoney(n: number): string {
  return `$${fmt(Math.round(n))}`;
}

function fmtSigned(n: number): string {
  if (n < 0) return `(${fmt(Math.abs(n))})`;
  return fmt(n);
}

function monthShortYm(ym: string): string {
  const d = new Date(`${ym.slice(0, 7)}-01T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function provenanceClass(p: InputProvenance | string, embedded = false): string {
  if (embedded) {
    if (p === "pulled" || p === "user-provided") return "prov data";
    if (p === "assumed") return "prov assumed";
    return "prov adjusted";
  }
  if (p === "pulled") return "chip prov-pulled";
  if (p === "user-provided") return "chip prov-user";
  if (p === "assumed") return "chip prov-assumed";
  return "chip prov-adjusted";
}

function provenanceLabel(p: InputProvenance | string): string {
  if (p === "pulled" || p === "adjusted") return "From your data";
  if (p === "user-provided") return "You entered";
  if (p === "assumed") return "Assumed default";
  return String(p);
}

const CHECK_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const FLAME_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3.5c2 3 5 4.5 5 8.5a5 5 0 0 1-10 0c0-1.6.6-2.7 1.4-3.7.3 1 .9 1.7 1.8 2 .2-2.8 1-4.9.8-6.8Z" />
  </svg>
);

function SpendPlanPanelBody({
  clientUserId,
  accounts,
  accountId,
  setAccountId,
  model,
  inputs,
  setInputs,
  paramDirty,
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
  embedded = false,
  onPick,
  clientName = "this client",
}: {
  clientUserId: string;
  accounts: { id: string; name: string }[];
  accountId: string;
  setAccountId: (id: string) => void;
  model: SpendPlanModelState["model"];
  inputs: SpendPlanModelState["inputs"];
  setInputs: SpendPlanModelState["setInputs"];
  paramDirty: SpendPlanParamDirty;
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
  embedded?: boolean;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  clientName?: string;
}) {
  const activeScenarios = scenarios ?? model?.scenarios ?? [];
  const hasScenarios = activeScenarios.length > 0;

  const primaryScenario = useMemo(() => {
    if (!model?.scenarioResults.length) return null;
    return (
      model.scenarioResults.find((s) => s.scenarioId === "history-repeats") ??
      model.scenarioResults[0]!
    );
  }, [model?.scenarioResults]);

  const projectionVerdict = useMemo(() => {
    if (!inputs || !primaryScenario) return null;
    const fail = primaryScenario.firstNegativeMonth != null;
    const low = primaryScenario.minCumulative;
    if (fail) {
      const t = primaryScenario.firstNegativeMonth!;
      const monthRow = model?.projection.find((r) => r.t === t);
      const when = monthRow
        ? monthShortYm(monthRow.month)
        : `month ${t}`;
      return {
        risk: true as const,
        title: `At a ${fmtMoney(inputs.base)} monthly allocation, the reserve does not carry through the ${inputs.horizon}-month horizon — cumulative goes negative in ${when}.`,
        sub: `The projected low point reaches ${fmtMoney(low)}. The caveat at the number applies: this assumes steady, recurring cash flow. One-off items are not predicted.`,
      };
    }
    return {
      risk: false as const,
      title: `At a ${fmtMoney(inputs.base)} monthly allocation, the reserve carries ${clientName} through the ${inputs.horizon}-month horizon.`,
      sub: `The projected low point stays near ${fmtMoney(low)}, well above zero. The caveat at the number applies: this assumes steady, recurring cash flow. One-off items are not predicted.`,
    };
  }, [inputs, primaryScenario, model?.projection, clientName]);

  const backtestVerdict = useMemo(() => {
    if (!model?.backtest?.length || !inputs) return null;
    const rows = model.backtest;
    const minC = Math.min(...rows.map((r) => r.cumulative));
    const nd = rows.filter((r) => r.surplus < 0).length;
    const held = minC >= 0;
    const firstNeg = rows.find((r) => r.cumulative < 0);
    return {
      nd,
      minC,
      held,
      text: held
        ? `At a ${fmtMoney(inputs.base)} allocation, the plan would have held. Low point of cumulative cash: ${fmtMoney(minC)}.`
        : `At a ${fmtMoney(inputs.base)} allocation, the plan would NOT have held${firstNeg ? ` — cumulative goes negative in ${monthShortYm(firstNeg.month)}` : ""}. Low point of cumulative cash: ${fmtMoney(minC)}.`,
      legacy: `${nd} monthly deficit${nd === 1 ? "" : "s"} · min cumulative ${fmtSigned(minC)} · ${held ? "the plan would have held" : "the plan would NOT have held"}`,
    };
  }, [model?.backtest, inputs]);

  const bufferValue = useMemo(() => {
    const inp = model?.inputs.find((i) => i.key === "starting_buffer");
    return typeof inp?.value === "number" ? inp.value : null;
  }, [model?.inputs]);

  const l0Value = useMemo(() => {
    const inp = model?.inputs.find((i) => i.key === "l0");
    return typeof inp?.value === "number" ? inp.value : null;
  }, [model?.inputs]);

  const l0WindowLabel = useMemo(() => {
    const w = model?.l0WindowMonths ?? [];
    if (w.length === 0) return null;
    const first = monthShortYm(w[0]!);
    const last = monthShortYm(w[w.length - 1]!);
    return { first, last, n: w.length };
  }, [model?.l0WindowMonths]);

  const yoyLabel = useMemo(() => {
    if (pulledTtmYoy == null) return { text: "—", pct: null as number | null };
    const pct = pulledTtmYoy * 100;
    const abs = Math.abs(pct).toFixed(2);
    if (pct > 0.0005) return { text: `Up ${abs}%`, pct };
    if (pct < -0.0005) return { text: `Down ${abs}%`, pct };
    return { text: "Unchanged 0%", pct };
  }, [pulledTtmYoy]);

  const completeMonthsYm = useMemo(
    () => (history?.completeMonths ?? []).map((m) => monthYm(m)),
    [history?.completeMonths]
  );

  const backtestSliderIndex = useMemo(() => {
    if (!inputs?.backtestStartMonth || completeMonthsYm.length === 0) return 0;
    const idx = completeMonthsYm.indexOf(inputs.backtestStartMonth.slice(0, 7));
    return idx >= 0 ? idx : 0;
  }, [inputs?.backtestStartMonth, completeMonthsYm]);

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
      snap: embedded
        ? {
            startMonth: startMonth.slice(0, 7),
            caveat: BACKTEST_START_MONTH_CAVEAT,
          }
        : undefined,
      label: `Backtest from ${startMonth.slice(0, 7)}`,
      sublabel: backtestVerdict?.legacy ?? backtestVerdict?.text,
    };
  }, [
    model?.backtest,
    inputs,
    studyId,
    accountId,
    backtestVerdict?.legacy,
    backtestVerdict?.text,
    embedded,
  ]);

  async function addPickableToDraft(draftKind: DraftKind, pickable: Pickable) {
    await onPick?.(draftKind, pickable);
  }

  function scenarioPickable(
    scenarioId: string,
    name: string,
    ending: number
  ): Pickable | null {
    if (!studyId) return null;
    return {
      kind: "scenario",
      params: { studyId, scenarioId },
      label: name,
      sublabel: `ending ${fmtSigned(ending)}`,
    };
  }

  const accountSelect = (
    <label className="flex flex-col gap-1 text-sm" style={{ marginBottom: 14 }}>
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
  );

  const projectionBlock =
    model && hasScenarios ? (
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
                          model.scenarios.find((sc) => sc.id === s.scenarioId)
                            ?.source ?? "assumed",
                          embedded
                        )}`}
                      >
                        {provenanceLabel(
                          model.scenarios.find((sc) => sc.id === s.scenarioId)
                            ?.source ?? "assumed"
                        )}
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
          style={{ border: "1px solid var(--line)", marginTop: 12 }}
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
    ) : model ? (
      <p className="treasury-meta text-sm">No scenarios — add one to project.</p>
    ) : null;

  const seasonalBlock = model ? (
    <div
      className="panel p-4 overflow-x-auto"
      style={{ border: "1px solid var(--line)", marginBottom: 12 }}
    >
      <p className="sec-title mb-2">Seasonal indices</p>
      <p className="treasury-meta-fine mb-2">
        n = years in the sample for that calendar month. Excluding a month can
        leave an index on a single observation — that is intentional.
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
  ) : null;

  const backtestTable =
    model?.backtest && model.backtest.length > 0 ? (
      <>
        <table className="w-full text-sm" style={{ marginTop: 12 }}>
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
          A single negative month is not an alert; the cumulative going negative
          is. Deficits in backtest: {model.backtestNegativeMonths ?? 0}.
        </p>
      </>
    ) : (
      <p className="treasury-meta text-sm">No backtest months available.</p>
    );

  if (embedded) {
    return (
      <div className="spend-plan-panel">
        <p className="engine-label">
          {ANALYZER_ENGINE_LABEL}. The two engines are labeled, never ranked; the
          authoritative one is your Summit team&apos;s setting.
        </p>

        {accountSelect}

        {error ? (
          <p className="text-sm text-cinnabar" role="alert">
            {error}
          </p>
        ) : null}
        {noHistory ? (
          <p className="treasury-meta text-sm" role="status">
            Import a book to see this
          </p>
        ) : null}
        {!noHistory && insufficientHistory ? (
          <p className="treasury-meta text-sm">
            Fewer than 3 complete months — baselines will be thin.
          </p>
        ) : null}

        {!noHistory && projectionVerdict ? (
          <div className={`verdict${projectionVerdict.risk ? " risk" : ""}`}>
            <span className="v-ic">
              {projectionVerdict.risk ? FLAME_ICON : CHECK_ICON}
            </span>
            <div>
              <div className="v-t">{projectionVerdict.title}</div>
              <div className="v-s">{projectionVerdict.sub}</div>
            </div>
          </div>
        ) : null}

        {!noHistory && model && inputs ? (
          <>
            <div className="figs">
              <div className="fig">
                <div className="f-l">Starting buffer</div>
                <div className="f-n num">
                  {bufferValue != null ? fmtMoney(bufferValue) : "—"}
                </div>
                <span className="prov data">From your data</span>
              </div>
              <div className="fig">
                <div className="f-l">Baseline monthly spend</div>
                <div className="f-n num">
                  {l0Value != null ? fmtMoney(l0Value) : "—"}
                </div>
                <span className="prov data">From your data</span>
              </div>
              <div className="fig">
                <div className="f-l">Horizon</div>
                <div className="f-n num">{inputs.horizon} months</div>
                <span
                  className={
                    paramDirty.horizon ? "prov data" : "prov assumed"
                  }
                >
                  {paramDirty.horizon ? "You entered" : "Assumed default"}
                </span>
              </div>
              <div className="fig">
                <div className="f-l">Compared to last year</div>
                <div className="f-n num">{yoyLabel.text}</div>
                <span className="prov data">From your data</span>
              </div>
            </div>
            <p className="meta" style={{ margin: "0 0 18px" }}>
              {l0WindowLabel
                ? `Baseline is the last ${l0WindowLabel.n} complete months in sample, ${l0WindowLabel.first} to ${l0WindowLabel.last}. `
                : null}
              Every number states its source: what you entered, an assumed
              default, or from your data.
            </p>

            <AnalyzerAnaControls
              inputs={inputs}
              paramDirty={paramDirty}
              setInputs={setInputs}
            />
          </>
        ) : null}

        <div className="rec-sec">
          <h2 className="rs-h">Which months are real</h2>
          <p className="rs-note">
            Deciding which months are real is the product. Exclusions are a view,
            never a deletion. Click a month to see its transactions, then set it
            aside if it is not typical of the book.
          </p>
        </div>
        {history && model ? (
          <div className="month-panel">
            <AnalyzerSampleSection
              clientUserId={clientUserId}
              history={history}
              excludedMonths={excludedMonths}
              l0={Number(model.inputs.find((i) => i.key === "l0")?.value ?? 0)}
              l0WindowMonths={model.l0WindowMonths}
              seasonalIndices={model.seasonalIndices}
              seasonalSampleCounts={model.seasonalSampleCounts}
              ttmYoy={pulledTtmYoy}
              bufferLabel={
                bufferValue != null ? String(bufferValue) : "—"
              }
              onToggle={toggleExcludedMonth}
              onReason={setExcludedReason}
              accountId={accountId}
              seriesLabel={history.label}
              onPick={addPickableToDraft}
            />
            <p className="month-legend meta">
              {history.completeMonths.length -
                excludedMonths.length}{" "}
              of {history.completeMonths.length} months in sample.
              {history.excludedPartialMonth
                ? ` ${monthShortYm(history.excludedPartialMonth)} is excluded automatically; a partial month is not a judgment call.`
                : null}
            </p>
          </div>
        ) : loading ? (
          <p className="treasury-meta">Loading Analyzer…</p>
        ) : null}

        {model ? (
          <>
            <div className="rec-sec">
              <h2 className="rs-h">The projection</h2>
              <p className="rs-note">
                We project each month&apos;s spend from your typical baseline,
                adjusted for growth and the season, then track the running cash
                position as your set allocation covers it or does not.
              </p>
            </div>
            <details className="showmath" style={{ marginBottom: 18 }}>
              <summary>Show the math</summary>
              <div className="sm-body">
                Projected spend for month t = baseline x (1 + growth)^(t/12) x
                seasonal index of that calendar month. Cumulative position =
                starting buffer + running sum of (allocation - spend).
              </div>
            </details>
            {model.seasonalityDisabled ? (
              <p className="treasury-meta-fine mb-2">
                Seasonality disabled — fewer than 12 distinct months in history.
              </p>
            ) : null}
            {seasonalBlock}
            <SpendPlanScenarioEditor
              scenarios={activeScenarios}
              setScenarios={setScenarios}
              pulledTtmYoy={pulledTtmYoy}
            />
            {projectionBlock}

            <div className="rec-sec">
              <h2 className="rs-h">The backtest</h2>
              <p className="rs-note">
                No assumptions: your allocation versus what actually left the
                bank. Exclusions do not touch this table. The actuals are the
                actuals. A single negative month is not an alert; the cumulative
                going negative is.
              </p>
            </div>
            <div className="scard" id="bt-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                {backtestVerdict ? (
                  <p className="bt-verdict" id="bt-verdict">
                    {backtestVerdict.text}
                  </p>
                ) : (
                  <p className="bt-verdict" id="bt-verdict">
                    Run the backtest once history is available.
                  </p>
                )}
                {backtestPickable ? (
                  <PickButton
                    variant="header"
                    pickable={backtestPickable}
                    onPick={addPickableToDraft}
                  />
                ) : null}
              </div>
              {inputs && completeMonthsYm.length > 0 ? (
                <div className="bt-start">
                  <label className="bt-start-l" htmlFor="bt-slider">
                    Backtest start month
                  </label>
                  <input
                    type="range"
                    id="bt-slider"
                    min={0}
                    max={Math.max(0, completeMonthsYm.length - 1)}
                    value={backtestSliderIndex}
                    step={1}
                    aria-label="Backtest start month"
                    aria-describedby="bt-start-label"
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      const ym = completeMonthsYm[i];
                      if (ym) setInputs({ backtestStartMonth: ym });
                    }}
                  />
                  <span className="bt-start-label" id="bt-start-label">
                    {monthShortYm(
                      completeMonthsYm[backtestSliderIndex] ??
                        inputs.backtestStartMonth
                    )}
                  </span>
                </div>
              ) : null}
              {backtestTable}
            </div>
            <p className="meta caveat-sens">{BACKTEST_START_MONTH_CAVEAT}</p>

            <p className="meta" style={{ marginTop: 18 }}>
              Add any figure to a draft with its caveat and, for a backtest
              figure, its start month, so the disclosure is never dropped between
              the analysis and the sealed recommendation.
            </p>
          </>
        ) : null}
      </div>
    );
  }

  /* Non-embedded (legacy shell) — keep functional inputs, same maths. */
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
        {accountSelect}
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

      {history && model ? (
        <AnalyzerSampleSection
          clientUserId={clientUserId}
          history={history}
          excludedMonths={excludedMonths}
          l0={Number(model.inputs.find((i) => i.key === "l0")?.value ?? 0)}
          l0WindowMonths={model.l0WindowMonths}
          seasonalIndices={model.seasonalIndices}
          seasonalSampleCounts={model.seasonalSampleCounts}
          ttmYoy={pulledTtmYoy}
          bufferLabel={bufferValue != null ? String(bufferValue) : "—"}
          onToggle={toggleExcludedMonth}
          onReason={setExcludedReason}
          accountId={accountId}
          seriesLabel={history.label}
          onPick={addPickableToDraft}
        />
      ) : null}

      {model ? (
        <>
          {seasonalBlock}
          <SpendPlanScenarioEditor
            scenarios={activeScenarios}
            setScenarios={setScenarios}
            pulledTtmYoy={pulledTtmYoy}
          />
          {projectionBlock}
          <div
            className="panel p-4 overflow-x-auto"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title mb-2 flex flex-wrap items-center gap-3">
              <span>The backtest</span>
              {backtestPickable ? (
                <PickButton
                  variant="header"
                  pickable={backtestPickable}
                  onPick={addPickableToDraft}
                />
              ) : null}
            </p>
            {inputs && completeMonthsYm.length > 0 ? (
              <div className="bt-start">
                <label className="bt-start-l" htmlFor="bt-slider-legacy">
                  Backtest start month
                </label>
                <input
                  type="range"
                  id="bt-slider-legacy"
                  min={0}
                  max={Math.max(0, completeMonthsYm.length - 1)}
                  value={backtestSliderIndex}
                  step={1}
                  aria-label="Backtest start month"
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    const ym = completeMonthsYm[i];
                    if (ym) setInputs({ backtestStartMonth: ym });
                  }}
                />
                <span className="bt-start-label">
                  {monthShortYm(
                    completeMonthsYm[backtestSliderIndex] ??
                      inputs.backtestStartMonth
                  )}
                </span>
              </div>
            ) : null}
            {backtestVerdict ? (
              <p className="bt-verdict">{backtestVerdict.text}</p>
            ) : null}
            {backtestTable}
          </div>
        </>
      ) : loading && !noHistory ? (
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
  embedded = false,
  onPick,
  clientName,
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
      paramDirty={state.paramDirty}
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
      embedded={embedded}
      onPick={onPick}
      clientName={clientName}
    />
  );
}
