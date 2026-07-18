"use client";

import { PickButton } from "@/components/operator/treasury/PickButton";
import type { SpendPlanHistoryResponse } from "@/lib/treasury/spend-plan";
import {
  monthYm,
  partitionIntoYearBlocks,
  meanOfMonths,
  fillCompleteMonthAmounts,
} from "@/lib/treasury/spend-plan";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import type { StudyExcludedMonth } from "@/lib/treasury/studies";

type Props = {
  history: SpendPlanHistoryResponse;
  excludedMonths: StudyExcludedMonth[];
  l0: number;
  l0WindowMonths: string[];
  seasonalIndices: Record<number, number>;
  ttmYoy: number | null;
  bufferLabel: string;
  onToggle: (monthYm: string) => void;
  onReason: (monthYm: string, reason: string) => void;
  accountId?: string;
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function reasonFor(
  excluded: StudyExcludedMonth[],
  ym: string
): string {
  return excluded.find((e) => monthYm(e.month) === ym)?.reason ?? "";
}

export function AnalyzerSampleSection({
  history,
  excludedMonths,
  l0,
  l0WindowMonths,
  seasonalIndices,
  ttmYoy,
  bufferLabel,
  onToggle,
  onReason,
  accountId,
  onPick,
}: Props) {
  const months = Object.keys(history.monthlyOutflows).sort();
  const excludedSet = new Set(excludedMonths.map((e) => monthYm(e.month)));
  const complete = history.completeMonths;
  const filled = fillCompleteMonthAmounts(history.monthlyOutflows, complete);
  const blocks = partitionIntoYearBlocks(complete);
  const y1Present =
    blocks[0]?.filter((k) => !excludedSet.has(monthYm(k))) ?? [];
  const y2Present =
    blocks[1]?.filter((k) => !excludedSet.has(monthYm(k))) ?? [];
  const y1 = meanOfMonths(filled, y1Present);
  const y2 = meanOfMonths(filled, y2Present);
  const inSample = months.filter((m) => !excludedSet.has(monthYm(m)));
  const maxDebit = Math.max(
    1,
    ...months.map((m) => history.monthlyOutflows[m] ?? 0)
  );
  const l6 = new Set(l0WindowMonths.map((m) => monthYm(m)));

  function monthPickable(ym: string, debits: number, idx: number | undefined): Pickable {
    const params: Record<string, unknown> = { month: ym };
    if (accountId) params.accountId = accountId;
    return {
      kind: "month",
      params,
      label: `Month ${ym}`,
      sublabel:
        idx != null
          ? `$${fmt(debits)} · index ${idx.toFixed(2)}`
          : `$${fmt(debits)}`,
    };
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="sec-title mb-1">01 · The sample</p>
        <p className="treasury-meta text-sm leading-relaxed max-w-[74ch]">
          Which months are real? Untick a month and L0, indices, and the
          projection recompute. The transaction is never deleted — the exclusion
          is an assumption stored with the study.
        </p>
      </div>

      <div className="panel p-4" style={{ border: "1px solid var(--line)" }}>
        <div
          className="flex items-end gap-0.5 h-[132px] border-b border-[var(--line)] pt-2"
          role="img"
          aria-label="Monthly PD debits chart"
        >
          {months.map((m) => {
            const ym = monthYm(m);
            const off = excludedSet.has(ym);
            const amt = history.monthlyOutflows[m] ?? 0;
            const h = Math.round((amt / maxDebit) * 118);
            const inL0 = l6.has(ym);
            return (
              <button
                key={m}
                type="button"
                title={`${ym} · $${fmt(amt)}${off ? " · excluded" : ""}`}
                className="flex-1 flex flex-col justify-end h-full cursor-pointer bg-transparent border-0 p-0"
                onClick={() => onToggle(ym)}
              >
                <span
                  className="block w-full rounded-t-sm"
                  style={{
                    height: `${h}px`,
                    background: off
                      ? "repeating-linear-gradient(45deg,#d7c6c3,#d7c6c3 2px,transparent 2px,transparent 5px)"
                      : inL0
                        ? "var(--accent, #EBC06D)"
                        : "var(--brand-2, #1A1A1B)",
                    opacity: off ? 0.7 : 1,
                  }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-[var(--mute)] flex-wrap">
          <span>In the sample</span>
          <span>L0 window (accent)</span>
          <span>Excluded (hatched)</span>
          <span className="ml-auto font-mono">
            {inSample.length} of {months.length} months in sample
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="panel p-4 overflow-x-auto" style={{ border: "1px solid var(--line)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="treasury-meta text-left border-b border-[var(--line)]">
                <th className="pb-2 pr-2">Month</th>
                <th className="pb-2 pr-2 text-right">PD Debits</th>
                <th className="pb-2 pr-2 text-right">Index</th>
                <th className="pb-2 pr-2 text-center">In</th>
                <th className="pb-2">Reason</th>
                {onPick ? <th className="pb-2 w-10" aria-label="Add to draft" /> : null}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const ym = monthYm(m);
                const off = excludedSet.has(ym);
                const cal = Number(ym.slice(5, 7));
                const idx = seasonalIndices[cal];
                const hl = l6.has(ym);
                return (
                  <tr
                    key={m}
                    className={`border-b border-[var(--line)] tabular-nums ${off ? "opacity-50" : ""} ${hl ? "bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]" : ""}`}
                  >
                    <td className="py-1.5 pr-2 font-mono text-xs">{ym}</td>
                    <td
                      className={`py-1.5 pr-2 text-right ${off ? "line-through" : ""}`}
                    >
                      ${fmt(history.monthlyOutflows[m] ?? 0)}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {off || idx == null ? "—" : idx.toFixed(2)}
                    </td>
                    <td className="py-1.5 pr-2 text-center">
                      <button
                        type="button"
                        className={`inline-block w-4 h-4 rounded border ${off ? "bg-transparent border-[var(--brand-2)]" : "bg-[var(--brand)] border-[var(--brand)]"}`}
                        aria-pressed={!off}
                        aria-label={off ? `Include ${ym}` : `Exclude ${ym}`}
                        onClick={() => onToggle(ym)}
                      />
                    </td>
                    <td className="py-1.5">
                      {off ? (
                        <input
                          className="w-full border-0 border-b border-dashed border-[var(--line)] bg-transparent text-xs italic text-[var(--su-neg,#E67E50)]"
                          value={reasonFor(excludedMonths, ym)}
                          placeholder="why?"
                          onChange={(e) => onReason(ym, e.target.value)}
                        />
                      ) : null}
                    </td>
                    {onPick ? (
                      <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                        <PickButton
                          variant="row"
                          pickable={monthPickable(
                            ym,
                            history.monthlyOutflows[m] ?? 0,
                            off ? undefined : idx
                          )}
                          onPick={onPick}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {history.excludedPartialMonth ? (
            <p className="treasury-meta-fine mt-3 italic">
              <b>{history.excludedPartialMonth}</b> is excluded automatically —
              partial months are not a judgment call.
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div
            className="grid grid-cols-2 gap-px bg-[var(--line)] border border-[var(--line)] rounded-lg overflow-hidden"
          >
            <div className="bg-[var(--paper,#FCFBF9)] p-3">
              <p className="treasury-meta-fine uppercase tracking-wide">Year 1 avg</p>
              <p className="text-lg font-semibold tabular-nums">${fmt(y1)}</p>
            </div>
            <div className="bg-[var(--paper,#FCFBF9)] p-3">
              <p className="treasury-meta-fine uppercase tracking-wide">Year 2 avg</p>
              <p className="text-lg font-semibold tabular-nums">${fmt(y2)}</p>
            </div>
            <div className="bg-[var(--paper,#FCFBF9)] p-3 col-span-2">
              <p className="treasury-meta-fine uppercase tracking-wide">
                Baseline monthly spend · L0{" "}
                <span className="chip prov-pulled ml-1">pulled</span>
              </p>
              <p className="text-lg font-semibold tabular-nums">${fmt(l0)}</p>
              <p className="treasury-meta-fine mt-1">
                last 6 complete in sample ·{" "}
                {l0WindowMonths[0]?.slice(0, 7) ?? "—"} …{" "}
                {l0WindowMonths[l0WindowMonths.length - 1]?.slice(0, 7) ?? "—"}
              </p>
            </div>
            <div className="bg-[var(--paper,#FCFBF9)] p-3">
              <p className="treasury-meta-fine uppercase tracking-wide">
                History repeats · YoY{" "}
                <span className="chip prov-pulled ml-1">pulled</span>
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {ttmYoy == null ? "—" : `${(ttmYoy * 100).toFixed(2)}%`}
              </p>
            </div>
            <div className="bg-[var(--paper,#FCFBF9)] p-3">
              <p className="treasury-meta-fine uppercase tracking-wide">
                Starting buffer
              </p>
              <p className="text-sm font-semibold tabular-nums">{bufferLabel}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
