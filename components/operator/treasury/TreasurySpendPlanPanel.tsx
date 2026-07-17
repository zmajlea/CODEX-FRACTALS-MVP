"use client";

import { useEffect, useMemo, useState } from "react";
import type { TreasuryAccountsResponse } from "@/lib/treasury/types";
import type { InputProvenance } from "@/lib/treasury/spend-plan";
import {
  useSpendPlanModel,
  type SpendPlanModelState,
} from "@/components/operator/treasury/spend-plan/useSpendPlanModel";

type Props = {
  clientUserId: string;
  accountsData: TreasuryAccountsResponse | null;
  /** Controlled account (Analytics shell). */
  accountId?: string;
  onAccountIdChange?: (id: string) => void;
  /** When provided, panel does not own the model hook (shell does). */
  modelState?: SpendPlanModelState;
  label?: string;
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
  accounts,
  accountId,
  setAccountId,
  model,
  inputs,
  setInputs,
  loading,
  error,
  noHistory,
  insufficientHistory,
}: {
  accounts: { id: string; name: string }[];
  accountId: string;
  setAccountId: (id: string) => void;
  model: SpendPlanModelState["model"];
  inputs: SpendPlanModelState["inputs"];
  setInputs: SpendPlanModelState["setInputs"];
  loading: boolean;
  error: string | null;
  noHistory: boolean;
  insufficientHistory: boolean;
}) {
  return (
    <div className="spend-plan-panel space-y-6">
      <div className="panel p-4" style={{ border: "1px solid var(--line)" }}>
        <p className="sec-title mb-2">Method</p>
        <p className="treasury-meta text-sm leading-relaxed">
          {model?.methodNote ??
            "Projected spend = L0 × (1+g)^(t/12) × seasonal index. Allocation = base + step × FLOOR((t−1)/stepEveryMonths). Cumulative = buffer + Σ(allocation − spend)."}
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
              <span className="treasury-meta">Step-up</span>
              <input
                className="field-input w-28"
                type="number"
                value={inputs.step}
                onChange={(e) =>
                  setInputs({ step: Number(e.target.value) || 0 })
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
                  setInputs({ horizon: Number(e.target.value) || 1 })
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="treasury-meta">Start month</span>
              <input
                className="field-input w-32"
                type="month"
                value={inputs.startMonth}
                onChange={(e) => setInputs({ startMonth: e.target.value })}
              />
            </label>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--su-neg)" }}>
          {error}
        </p>
      ) : null}

      {noHistory ? (
        <p className="treasury-meta text-sm">
          No outflow history for this account — spend plan cannot be derived.
        </p>
      ) : null}

      {insufficientHistory ? (
        <p className="treasury-meta text-sm">
          Fewer than 3 complete months of history — projections may be unreliable.
        </p>
      ) : null}

      {model ? (
        <>
          <div className="panel p-4" style={{ border: "1px solid var(--line)" }}>
            <p className="sec-title mb-3">Inputs</p>
            <dl className="grid gap-2 sm:grid-cols-2 text-sm">
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
            {model.l0WindowMonths.length > 0 ? (
              <p className="treasury-meta-fine mt-1">
                L0 window:{" "}
                {model.l0WindowMonths.map((m) => m.slice(0, 7)).join(", ")}
              </p>
            ) : null}
          </div>

          <div
            className="panel p-4 overflow-x-auto"
            style={{ border: "1px solid var(--line)" }}
          >
            <p className="sec-title mb-2">Seasonal indices</p>
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
                  {MONTH_NAMES.map((_, i) => (
                    <td key={i} className="pr-2">
                      {(model.seasonalIndices[i + 1] ?? 1).toFixed(2)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

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
                </tr>
              </thead>
              <tbody>
                {model.scenarioResults.map((s) => (
                  <tr
                    key={s.scenarioId}
                    className="border-b border-[var(--line)] tabular-nums"
                  >
                    <td className="py-2 pr-3 font-medium">
                      {s.scenarioName}
                      <span
                        className={`ml-2 ${provenanceClass(
                          model.scenarios.find((sc) => sc.id === s.scenarioId)
                            ?.source ?? "assumed"
                        )}`}
                      >
                        {model.scenarios.find((sc) => sc.id === s.scenarioId)
                          ?.source ?? "assumed"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{s.deficitMonths}</td>
                    <td className="py-2 pr-3">{fmtSigned(s.minCumulative)}</td>
                    <td className="py-2 pr-3">{fmtSigned(s.endingPosition)}</td>
                    <td className="py-2">{s.firstNegativeMonth ?? "—"}</td>
                  </tr>
                ))}
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

          {model.backtest && model.backtest.length > 0 ? (
            <div
              className="panel p-4 overflow-x-auto"
              style={{ border: "1px solid var(--line)" }}
            >
              <p className="sec-title mb-2">Backtest</p>
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
                Monthly deficits can occur while cumulative stays positive.
                Negative months in backtest: {model.backtestNegativeMonths ?? 0}.
              </p>
            </div>
          ) : null}
        </>
      ) : loading ? (
        <p className="treasury-meta">Loading spend plan…</p>
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
      accounts={accounts}
      accountId={accountId}
      setAccountId={setAccountId}
      model={state.model}
      inputs={state.inputs}
      setInputs={state.setInputs}
      loading={state.loading}
      error={state.error}
      noHistory={state.noHistory}
      insufficientHistory={state.insufficientHistory}
    />
  );
}
