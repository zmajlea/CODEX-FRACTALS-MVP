/**
 * Spec 65 Part J — client-facing monthly report (HTML export).
 */

import type { CashModelIntervention } from "@/lib/treasury/cash-model-interventions";
import type { CashModelBacktestRow } from "@/lib/treasury/cash-model-backtest";
import type { CashModelRunwayStatus } from "@/lib/treasury/cash-model-types";
import type { CashModelComposedResponse } from "@/lib/treasury/cash-model-compose";
import type { CashModelParams, CashModelScenario } from "@/lib/treasury/cash-model-types";

export type CashModelReportInput = {
  clientName: string;
  accountName: string;
  generatedAt: string;
  result: CashModelComposedResponse;
  params: CashModelParams;
  scenarios: CashModelScenario[];
  runwayStatus: CashModelRunwayStatus | null;
  interventions: CashModelIntervention[];
  backtest: CashModelBacktestRow[];
};

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function narrative(input: CashModelReportInput): string {
  const sel = input.result.summaries.find(
    (s) => s.scenarioId === input.params.selectedScenarioId
  );
  if (!sel) return "Insufficient model output for narrative.";
  if (sel.noBreachInHorizon) {
    return `Cash stays above the minimum floor over the next ${input.params.horizon} months under the selected scenario, with a low point of ${fmtMoney(sel.minEnding.value)} in ${monthLabel(sel.minEnding.month)}.`;
  }
  return `Under the selected scenario, cash is projected to breach the minimum floor in ${monthLabel(sel.breachMonth ?? "")}${
    sel.runwayMonths != null ? ` (${sel.runwayMonths} months from today)` : ""
  }. The low point is ${fmtMoney(sel.minEnding.value)} in ${monthLabel(sel.minEnding.month)}. Coverage is ${Math.round(input.result.coveragePct * 100)}% of recent flow.`;
}

export function buildCashModelReportHtml(input: CashModelReportInput): string {
  const sel = input.result.summaries.find(
    (s) => s.scenarioId === input.params.selectedScenarioId
  );
  const clearing = input.interventions.find((i) => i.clearsBreach);

  const cascadeRows = input.result.timeline
    .map(
      (r) =>
        `<tr><td>${escapeHtml(monthLabel(r.month))}</td><td>${r.kind}${r.historyDerived ? " · derived" : ""}</td><td style="text-align:right">${fmtMoney(r.ncf)}</td><td style="text-align:right">${fmtMoney(r.ending)}</td><td>${r.breachFlag ? "yes" : "—"}</td></tr>`
    )
    .join("");

  const interventionRows = input.interventions
    .slice(0, 6)
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.label)}</td><td>${escapeHtml(i.description)}</td><td>${i.clearsBreach ? "Clears floor" : "—"}</td></tr>`
    )
    .join("");

  const backtestRows = input.backtest
    .map(
      (b) =>
        `<tr><td>${escapeHtml(monthLabel(b.asOfMonth))}</td><td>${b.predictedBreachMonth ? escapeHtml(monthLabel(b.predictedBreachMonth)) : "—"}</td><td>${b.actualBreachMonth ? escapeHtml(monthLabel(b.actualBreachMonth)) : "—"}</td><td>${b.match ? "match" : "diverged"}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Cash model report — ${escapeHtml(input.clientName)}</title>
  <style>
    body { font-family: Georgia, serif; color: #1a1a1b; background: #fcfaf9; margin: 2rem; line-height: 1.5; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .headline { font-size: 1.15rem; margin: 1rem 0; padding: 1rem; border: 1px solid #ded9d1; border-radius: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.85rem; }
    th, td { border-bottom: 1px solid #ded9d1; padding: 0.4rem 0.5rem; text-align: left; }
    th { font-weight: 600; color: #444; }
    .sec { margin-top: 1.75rem; }
    .chip { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #ebe6dd; font-size: 0.8rem; }
    @media print { body { margin: 1cm; } }
  </style>
</head>
<body>
  <h1>Monthly cash model report</h1>
  <p class="meta">${escapeHtml(input.clientName)} · ${escapeHtml(input.accountName)} · generated ${escapeHtml(input.generatedAt)} · as of ${escapeHtml(input.result.asOf)}</p>

  <div class="headline">
    <strong>Runway</strong><br />
    ${escapeHtml(input.runwayStatus?.label ?? (sel?.noBreachInHorizon ? "No breach in horizon" : sel?.breachMonth ? `Breach · ${monthLabel(sel.breachMonth)}` : "—"))}
  </div>

  <p>${escapeHtml(narrative(input))}</p>
  ${input.result.degradedToTotals ? `<p class="chip">Totals-only mode — low categorization coverage</p>` : ""}
  ${input.result.derived_snapshot.historyDerived ? `<p class="chip">History ending derived from current balance</p>` : ""}

  <div class="sec">
    <h2>Cascade</h2>
    <table>
      <thead><tr><th>Month</th><th>Kind</th><th style="text-align:right">NCF</th><th style="text-align:right">Ending</th><th>Breach</th></tr></thead>
      <tbody>${cascadeRows}</tbody>
    </table>
  </div>

  ${
    clearing
      ? `<div class="sec"><h2>Smallest clearing intervention (proposal)</h2><p>${escapeHtml(clearing.label)} — ${escapeHtml(clearing.description)}. Not applied — for discussion only.</p></div>`
      : input.interventions.length
        ? `<div class="sec"><h2>Interventions (proposals)</h2><table><thead><tr><th>Action</th><th>Effect</th><th>Outcome</th></tr></thead><tbody>${interventionRows}</tbody></table></div>`
        : ""
  }

  ${
    input.backtest.length
      ? `<div class="sec"><h2>Backtest credibility</h2><table><thead><tr><th>As-of</th><th>Predicted breach</th><th>Actual breach</th><th>Match</th></tr></thead><tbody>${backtestRows}</tbody></table></div>`
      : ""
  }

  <p class="meta">Prepared from labeled transaction history. Uncategorized flow appears explicitly in the model.</p>
</body>
</html>`;
}

export function downloadCashModelReportHtml(input: CashModelReportInput): void {
  const html = buildCashModelReportHtml(input);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = input.clientName.replace(/[^\w]+/g, "-").slice(0, 40);
  a.href = url;
  a.download = `cash-model-${slug}-${input.result.asOf.slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
