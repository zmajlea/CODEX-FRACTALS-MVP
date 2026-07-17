"use client";

import { useEffect, useRef } from "react";
import type { InputProvenance, SpendPlanScenario } from "@/lib/treasury/spend-plan";

function provenanceClass(p: InputProvenance | string): string {
  if (p === "pulled") return "chip prov-pulled";
  if (p === "user-provided") return "chip prov-user";
  if (p === "assumed") return "chip prov-assumed";
  return "chip prov-adjusted";
}

type Props = {
  scenarios: SpendPlanScenario[];
  setScenarios: (next: SpendPlanScenario[]) => void;
  /** Current pulled TTM YoY (fraction) for History-repeats Reset. */
  pulledTtmYoy: number | null;
};

export function SpendPlanScenarioEditor({
  scenarios,
  setScenarios,
  pulledTtmYoy,
}: Props) {
  const pulledBaselines = useRef<Record<string, number>>({});

  useEffect(() => {
    for (const sc of scenarios) {
      if (sc.source === "pulled") {
        pulledBaselines.current[sc.id] = sc.growthPct;
      }
    }
  }, [scenarios]);

  const update = (id: string, patch: Partial<SpendPlanScenario>) => {
    setScenarios(
      scenarios.map((sc) => {
        if (sc.id !== id) return sc;
        const next = { ...sc, ...patch };
        if (
          patch.growthPct !== undefined &&
          sc.source === "pulled" &&
          patch.source === undefined
        ) {
          next.source = "assumed";
        }
        return next;
      })
    );
  };

  const remove = (id: string) => {
    setScenarios(scenarios.filter((sc) => sc.id !== id));
  };

  const add = () => {
    setScenarios([
      ...scenarios,
      {
        id: crypto.randomUUID(),
        name: "Custom",
        growthPct: 0.3,
        source: "assumed",
      },
    ]);
  };

  const resetPulled = (id: string) => {
    const baseline =
      id === "history-repeats" && pulledTtmYoy != null
        ? pulledTtmYoy
        : pulledBaselines.current[id];
    if (baseline === undefined) return;
    setScenarios(
      scenarios.map((sc) =>
        sc.id === id
          ? { ...sc, growthPct: baseline, source: "pulled" as const }
          : sc
      )
    );
  };

  const canReset = (sc: SpendPlanScenario): boolean => {
    if (sc.source !== "assumed") return false;
    if (sc.id === "history-repeats" && pulledTtmYoy != null) return true;
    return sc.id in pulledBaselines.current;
  };

  return (
    <div className="panel p-4" style={{ border: "1px solid var(--line)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="sec-title">Scenarios</p>
        <button type="button" className="btn btn-secondary text-sm" onClick={add}>
          Add scenario
        </button>
      </div>
      {scenarios.length === 0 ? (
        <p className="treasury-meta text-sm">
          No scenarios — add one to project growth cases.
        </p>
      ) : (
        <ul className="space-y-3">
          {scenarios.map((sc) => (
            <li
              key={sc.id}
              className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] pb-3 last:border-0 last:pb-0"
            >
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm">
                <span className="treasury-meta">Name</span>
                <input
                  className="field-input"
                  type="text"
                  value={sc.name}
                  onChange={(e) => update(sc.id, { name: e.target.value })}
                />
              </label>
              <label className="flex w-28 flex-col gap-1 text-sm">
                <span className="treasury-meta">Growth %</span>
                <input
                  className="field-input"
                  type="number"
                  step="0.1"
                  value={Number((sc.growthPct * 100).toFixed(4))}
                  onChange={(e) => {
                    const uiPercent = Number(e.target.value);
                    const growthPct = Number.isFinite(uiPercent)
                      ? uiPercent / 100
                      : 0;
                    update(sc.id, {
                      growthPct,
                      ...(sc.source === "pulled" ? { source: "assumed" as const } : {}),
                    });
                  }}
                />
              </label>
              <span className={provenanceClass(sc.source)}>{sc.source}</span>
              {canReset(sc) ? (
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  onClick={() => resetPulled(sc.id)}
                >
                  Reset
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary text-sm"
                onClick={() => remove(sc.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
