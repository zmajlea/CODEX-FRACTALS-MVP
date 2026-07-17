"use client";

import { useEffect, useMemo, useState, useDeferredValue, useCallback } from "react";
import {
  addMonths,
  subtractMonths,
} from "@/lib/treasury/period-bounds";
import {
  buildDefaultScenarios,
  buildSpendPlanFromHistory,
  computeL0,
  computeSeasonalIndices,
  computeTtmYoyGrowth,
  defaultPlanStartMonth,
  deriveCompleteMonths,
  fillCompleteMonthAmounts,
  lastNFromCompleteMonths,
  roundBaseDefault,
  seasonalWindowFromCompleteMonths,
  type SpendPlanHistoryResponse,
  type SpendPlanResponse,
  type SpendPlanScenario,
} from "@/lib/treasury/spend-plan";
import {
  buildDerivedSnapshot,
  type DerivedSnapshot,
  type StudyBaselineOverrides,
  emptyOverrides,
} from "@/lib/treasury/studies";

export type SpendPlanModelInputs = {
  base: number;
  step: number;
  stepEveryMonths: number;
  horizon: number;
  startMonth: string;
  backtestMonths: number;
  bufferAdjustment: number;
};

export type SpendPlanModelState = {
  model: SpendPlanResponse | null;
  history: SpendPlanHistoryResponse | null;
  inputs: SpendPlanModelInputs | null;
  setInputs: (patch: Partial<SpendPlanModelInputs>) => void;
  overrides: StudyBaselineOverrides;
  setOverrides: (next: StudyBaselineOverrides) => void;
  scenarios: SpendPlanScenario[] | null;
  setScenarios: (next: SpendPlanScenario[]) => void;
  currentSnapshot: DerivedSnapshot | null;
  /** Pulled L0 from current history (ignores Keep-saved override). */
  pulledL0: number | null;
  loading: boolean;
  error: string | null;
  noHistory: boolean;
  insufficientHistory: boolean;
  resync: () => void;
  applySeed: (seed: {
    accountId: string;
    inputs: Partial<SpendPlanModelInputs>;
    overrides: StudyBaselineOverrides;
    scenarios?: SpendPlanScenario[];
  }) => void;
};

function computeCurrentSnapshot(
  history: SpendPlanHistoryResponse
): { snapshot: DerivedSnapshot; pulledL0: number } {
  const completeMonths = history.completeMonths;
  const filled = fillCompleteMonthAmounts(history.monthlyOutflows, completeMonths);
  const l0Window = lastNFromCompleteMonths(completeMonths, 6);
  const pulledL0 = computeL0(filled, l0Window) ?? 0;
  const seasonalKeys = seasonalWindowFromCompleteMonths(completeMonths, 24);
  const seasonal = computeSeasonalIndices(filled, seasonalKeys, history.asOf);
  const ttmYoy = computeTtmYoyGrowth(filled, completeMonths);
  return {
    pulledL0,
    snapshot: buildDerivedSnapshot({
      l0: pulledL0,
      l0Window,
      seasonal,
      ttmYoy,
      buffer: history.buffer,
      asOf: history.asOf,
      excludedPartialMonth: history.excludedPartialMonth,
      historyMonthCount: history.historyMonthCount,
    }),
  };
}

export function useSpendPlanModel(
  clientUserId: string,
  accountId: string,
  label?: string
): SpendPlanModelState {
  const [history, setHistory] = useState<SpendPlanHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputsState] = useState<SpendPlanModelInputs | null>(null);
  const [overrides, setOverrides] = useState<StudyBaselineOverrides>(emptyOverrides());
  const [scenarios, setScenarios] = useState<SpendPlanScenario[] | null>(null);
  const [syncKey, setSyncKey] = useState(0);
  const [seedToken, setSeedToken] = useState(0);

  const resync = useCallback(() => setSyncKey((k) => k + 1), []);

  const applySeed = useCallback(
    (seed: {
      accountId: string;
      inputs: Partial<SpendPlanModelInputs>;
      overrides: StudyBaselineOverrides;
      scenarios?: SpendPlanScenario[];
    }) => {
      setOverrides(seed.overrides);
      if (seed.scenarios) setScenarios(seed.scenarios);
      setInputsState((prev) =>
        prev
          ? { ...prev, ...seed.inputs }
          : {
              base: seed.inputs.base ?? 0,
              step: seed.inputs.step ?? 0,
              stepEveryMonths: seed.inputs.stepEveryMonths ?? 3,
              horizon: seed.inputs.horizon ?? 24,
              startMonth: seed.inputs.startMonth ?? "",
              backtestMonths: seed.inputs.backtestMonths ?? 12,
              bufferAdjustment: seed.inputs.bufferAdjustment ?? 0,
            }
      );
      setSeedToken((t) => t + 1);
    },
    []
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        account_id: accountId,
        view: "history",
      });
      if (label) params.set("label", label);

      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/spend-plan?${params}`
      );
      const json = (await res.json()) as SpendPlanHistoryResponse & {
        error?: string;
      };
      if (cancelled) return;

      if (!res.ok) {
        setError(json.error ?? "Failed to load spend plan history");
        setHistory(null);
        setInputsState(null);
        setScenarios(null);
      } else {
        setHistory(json);
        const completeMonths = json.completeMonths;
        const filled = fillCompleteMonthAmounts(
          json.monthlyOutflows,
          completeMonths
        );
        const l0Window = lastNFromCompleteMonths(completeMonths, 6);
        const l0 = computeL0(filled, l0Window) ?? 0;
        const planStart = defaultPlanStartMonth(json.asOf).slice(0, 7);
        const btMonths = Math.min(12, completeMonths.length);
        const ttmYoy = computeTtmYoyGrowth(filled, completeMonths);

        // Fresh scope load resets overrides unless a seed just applied.
        setInputsState((prev) => {
          if (seedToken > 0 && prev) return prev;
          return {
            base: roundBaseDefault(l0),
            step: 0,
            stepEveryMonths: 3,
            horizon: 24,
            startMonth: planStart,
            backtestMonths: btMonths,
            bufferAdjustment: 0,
          };
        });
        if (seedToken === 0) {
          setOverrides(emptyOverrides());
          setScenarios(buildDefaultScenarios(ttmYoy));
        } else if (!scenarios) {
          setScenarios(buildDefaultScenarios(ttmYoy));
        }
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // seedToken intentionally omitted from deps — only gates reset after applySeed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientUserId, accountId, label, syncKey]);

  const setInputs = useCallback((patch: Partial<SpendPlanModelInputs>) => {
    setInputsState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (patch.stepEveryMonths !== undefined) {
        next.stepEveryMonths = Math.max(1, Number(patch.stepEveryMonths) || 1);
      }
      return next;
    });
  }, []);

  const setScenariosStable = useCallback((next: SpendPlanScenario[]) => {
    setScenarios(next);
  }, []);

  const deferredInputs = useDeferredValue(inputs);
  const deferredOverrides = useDeferredValue(overrides);

  const snapshotBundle = useMemo(() => {
    if (!history) return null;
    return computeCurrentSnapshot(history);
  }, [history]);

  const model = useMemo((): SpendPlanResponse | null => {
    if (!history || !deferredInputs) return null;

    const asOf = history.asOf;
    const planStart = `${deferredInputs.startMonth}-01`;
    const completeMonths = history.completeMonths;
    const filled = fillCompleteMonthAmounts(
      history.monthlyOutflows,
      completeMonths
    );
    const ttmYoy = computeTtmYoyGrowth(filled, completeMonths);
    const activeScenarios =
      scenarios ?? buildDefaultScenarios(ttmYoy);

    const pulledBuffer = history.buffer?.value ?? 0;
    const bufferOverride = deferredOverrides.buffer;
    const startingBuffer =
      (bufferOverride != null ? bufferOverride : pulledBuffer) +
      deferredInputs.bufferAdjustment;
    const bufferAdjusted = bufferOverride != null;

    const btMonths = deferredInputs.backtestMonths;
    let backtest:
      | {
          startMonth: string;
          startingBuffer: number;
          base: number;
          step: number;
          stepEveryMonths: number;
          actualDebits: Record<string, number>;
          monthCount: number;
        }
      | undefined;

    if (btMonths > 0 && completeMonths.length > 0) {
      const btStart =
        completeMonths.length >= btMonths
          ? completeMonths[completeMonths.length - btMonths]!
          : completeMonths[0] ?? subtractMonths(planStart, btMonths);

      const actualDebits: Record<string, number> = {};
      for (let i = 0; i < btMonths; i++) {
        const m = addMonths(btStart, i);
        actualDebits[m] = filled[m] ?? 0;
      }

      backtest = {
        startMonth: btStart,
        startingBuffer: 0,
        base: deferredInputs.base,
        step: deferredInputs.step,
        stepEveryMonths: deferredInputs.stepEveryMonths,
        actualDebits,
        monthCount: btMonths,
      };
    }

    return buildSpendPlanFromHistory({
      planStartMonth: planStart,
      asOf,
      horizon: deferredInputs.horizon,
      startingBuffer,
      base: deferredInputs.base,
      step: deferredInputs.step,
      stepEveryMonths: deferredInputs.stepEveryMonths,
      monthlyDebits: history.monthlyOutflows,
      scenarios: activeScenarios,
      fixedL0: deferredOverrides.l0 ?? undefined,
      fixedSeasonalIndices: deferredOverrides.seasonalIndices ?? undefined,
      bufferAdjusted,
      backtest,
    });
  }, [history, deferredInputs, deferredOverrides, scenarios]);

  return {
    model,
    history,
    inputs,
    setInputs,
    overrides,
    setOverrides,
    scenarios,
    setScenarios: setScenariosStable,
    currentSnapshot: snapshotBundle?.snapshot ?? null,
    pulledL0: snapshotBundle?.pulledL0 ?? null,
    loading,
    error,
    noHistory: (history?.historyMonthCount ?? 0) === 0,
    insufficientHistory:
      (history?.historyMonthCount ?? 0) > 0 &&
      (history?.historyMonthCount ?? 0) < 3,
    resync,
    applySeed,
  };
}
