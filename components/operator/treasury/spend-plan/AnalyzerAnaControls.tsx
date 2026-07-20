"use client";

import { useState } from "react";
import { addMonths, subtractMonths } from "@/lib/treasury/period-bounds";
import type { SpendPlanModelInputs } from "@/components/operator/treasury/spend-plan/useSpendPlanModel";
import type { SpendPlanParamDirty } from "@/components/operator/treasury/spend-plan/useSpendPlanModel";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function provLabel(dirty: boolean): { text: string; className: string } {
  return dirty
    ? { text: "You entered", className: "prov data" }
    : { text: "Assumed default", className: "prov assumed" };
}

type Props = {
  inputs: SpendPlanModelInputs;
  paramDirty: SpendPlanParamDirty;
  setInputs: (patch: Partial<SpendPlanModelInputs>) => void;
};

function EditableAcn({
  display,
  onCommit,
}: {
  display: string;
  onCommit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);

  if (!editing) {
    return (
      <button
        type="button"
        className="acn num"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "text",
          font: "inherit",
          fontSize: 20,
          fontWeight: 700,
        }}
        onClick={() => {
          setDraft(display.replace(/[^0-9.-]/g, ""));
          setEditing(true);
        }}
      >
        {display}
      </button>
    );
  }

  return (
    <input
      className="acn num"
      autoFocus
      value={draft}
      style={{
        width: "6ch",
        font: "inherit",
        fontSize: 20,
        fontWeight: 700,
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "2px 4px",
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onCommit(draft);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onCommit(draft);
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

/** Spec 46d §4 — stepper dials with click-to-type. */
export function AnalyzerAnaControls({ inputs, paramDirty, setInputs }: Props) {
  const allocProv = provLabel(paramDirty.base);
  const stepProv = provLabel(paramDirty.step);
  const horizonProv = provLabel(paramDirty.horizon);
  const startProv = provLabel(paramDirty.startMonth);

  return (
    <>
      <div className="rec-sec">
        <h2 className="rs-h">The controls</h2>
        <p className="rs-note">
          Change an assumption and the verdict moves. Each control states its source
          inline; adjust it and the projection recomputes.
        </p>
      </div>
      <div className="an-controls" id="an-controls">
        <div className="an-ctrl">
          <span className="acl">Base allocation</span>
          <div className="acv">
            <button
              type="button"
              className="acstep"
              aria-label="Lower the base allocation"
              onClick={() =>
                setInputs({ base: Math.max(0, inputs.base - 250) })
              }
            >
              −
            </button>
            <EditableAcn
              display={money(inputs.base)}
              onCommit={(raw) => {
                const n = Number(raw.replace(/[^0-9.-]/g, ""));
                if (Number.isFinite(n)) setInputs({ base: Math.max(0, n) });
              }}
            />
            <span className="acu">per month</span>
            <button
              type="button"
              className="acstep"
              aria-label="Raise the base allocation"
              onClick={() => setInputs({ base: inputs.base + 250 })}
            >
              +
            </button>
          </div>
          <span className={allocProv.className}>{allocProv.text}</span>
        </div>

        <div className="an-ctrl">
          <span className="acl">Step up</span>
          <div className="acv">
            <button
              type="button"
              className="acstep"
              aria-label="Lower the step"
              onClick={() =>
                setInputs({ step: Math.max(0, inputs.step - 100) })
              }
            >
              −
            </button>
            <EditableAcn
              display={money(inputs.step)}
              onCommit={(raw) => {
                const n = Number(raw.replace(/[^0-9.-]/g, ""));
                if (Number.isFinite(n)) setInputs({ step: Math.max(0, n) });
              }}
            />
            <span className="acu">
              every {inputs.stepEveryMonths} month
              {inputs.stepEveryMonths === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="acstep"
              aria-label="Raise the step"
              onClick={() => setInputs({ step: inputs.step + 100 })}
            >
              +
            </button>
          </div>
          <span className={stepProv.className}>{stepProv.text}</span>
          <label className="meta" style={{ marginTop: 4 }}>
            Step every{" "}
            <input
              type="number"
              min={1}
              className="field-input"
              style={{ width: 52, display: "inline-block", marginLeft: 6 }}
              value={inputs.stepEveryMonths}
              onChange={(e) =>
                setInputs({
                  stepEveryMonths: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />{" "}
            months
          </label>
        </div>

        <div className="an-ctrl">
          <span className="acl">Horizon</span>
          <div className="acv">
            <button
              type="button"
              className="acstep"
              aria-label="Shorten the horizon"
              onClick={() =>
                setInputs({
                  horizon: Math.max(6, inputs.horizon - 1),
                })
              }
            >
              −
            </button>
            <EditableAcn
              display={String(inputs.horizon)}
              onCommit={(raw) => {
                const n = Number(raw.replace(/[^0-9]/g, ""));
                if (Number.isFinite(n)) {
                  setInputs({ horizon: Math.min(60, Math.max(6, n)) });
                }
              }}
            />
            <span className="acu">months</span>
            <button
              type="button"
              className="acstep"
              aria-label="Lengthen the horizon"
              onClick={() =>
                setInputs({
                  horizon: Math.min(60, inputs.horizon + 1),
                })
              }
            >
              +
            </button>
          </div>
          <span className={horizonProv.className}>{horizonProv.text}</span>
        </div>

        <div className="an-ctrl">
          <span className="acl">Projection start</span>
          <div className="acv">
            <button
              type="button"
              className="acstep"
              aria-label="Earlier start month"
              onClick={() => {
                const prev = subtractMonths(`${inputs.startMonth}-01`, 1);
                setInputs({ startMonth: prev.slice(0, 7) });
              }}
            >
              ‹
            </button>
            <span className="acn">{monthLabel(inputs.startMonth)}</span>
            <button
              type="button"
              className="acstep"
              aria-label="Later start month"
              onClick={() => {
                const next = addMonths(`${inputs.startMonth}-01`, 1);
                setInputs({ startMonth: next.slice(0, 7) });
              }}
            >
              ›
            </button>
          </div>
          <span className={startProv.className}>{startProv.text}</span>
        </div>
      </div>
    </>
  );
}
