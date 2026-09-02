import type { AssembledBoard } from "@/lib/treasury/analytics-assemble";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Inline SVG column/line chart from envelope points (same numbers as MetricChart). */
export function chartSvg(series: {
  points: Array<{ bucket_label: string; value: number; breaches?: string[] }>;
  reference_lines?: Array<{ label: string; value: number }>;
  chart_hint?: string;
}): string {
  const points = series.points ?? [];
  if (!points.length) return `<p class="meta">No points</p>`;
  const width = 560;
  const height = 160;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const vals = [
    ...points.map((p) => p.value),
    ...(series.reference_lines ?? []).map((r) => r.value),
    0,
  ];
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = maxV - minV || 1;
  const yAt = (v: number) => padT + innerH - ((v - minV) / span) * innerH;
  const n = points.length;
  const slot = innerW / n;
  const barW = Math.max(1, slot * 0.7);
  const hint = series.chart_hint ?? "column";

  let body = "";
  // Zero baseline
  body += `<line x1="${padL}" x2="${width - padR}" y1="${yAt(0)}" y2="${yAt(0)}" stroke="#c5d0dc" stroke-width="1" />`;
  if (hint === "line") {
    const pts = points
      .map((p, i) => `${padL + i * slot + slot / 2},${yAt(p.value)}`)
      .join(" ");
    body += `<polyline fill="none" stroke="#102a47" stroke-width="1.5" points="${pts}" />`;
    body += points
      .map((p, i) => {
        const cx = padL + i * slot + slot / 2;
        const cy = yAt(p.value);
        const r = (p.breaches?.length ?? 0) > 0 ? 3.5 : 2.5;
        const fill = (p.breaches?.length ?? 0) > 0 ? "#E67E50" : "#102a47";
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" />`;
      })
      .join("");
  } else {
    body += points
      .map((p, i) => {
        const x = padL + i * slot + (slot - barW) / 2;
        const y0 = yAt(0);
        const y1 = yAt(p.value);
        const top = Math.min(y0, y1);
        const h = Math.max(1, Math.abs(y1 - y0));
        const fill = (p.breaches?.length ?? 0) > 0 ? "#E67E50" : "#174a7a";
        return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" fill="${fill}" opacity="0.75" />`;
      })
      .join("");
  }
  for (const line of series.reference_lines ?? []) {
    const y = yAt(line.value);
    body += `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}" stroke="#1fc5d9" stroke-dasharray="4 3" />`;
    body += `<text x="${width - padR}" y="${y - 3}" text-anchor="end" font-size="9" fill="#174a7a">${esc(line.label)}</text>`;
  }
  // Sparse x labels
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  body += points
    .map((p, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return "";
      const x = padL + i * slot + slot / 2;
      return `<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#5a6f86">${esc(p.bucket_label)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export type RenderHtmlOptions = {
  /** Spec B8 Path C — auto-invoke browser print dialog. */
  autoPrint?: boolean;
};

/** Spec B7/B8 — branded HTML for print / Save as PDF (same assemble payload). */
export function renderAnalyticsBoardHtml(
  assembled: AssembledBoard,
  opts: RenderHtmlOptions = {}
): string {
  const { board, items, as_of } = assembled;
  const sections = items
    .map((it) => {
      if (it.missing || !it.computed) {
        return `<section class="card"><h2>${esc(it.metric?.name ?? "Metric")}</h2><p class="meta">Unavailable</p></section>`;
      }
      const title = esc(it.metric?.name ?? "Metric");
      const desc = esc(it.metric?.description ?? "");
      if (it.computed.kind === "analytics" && it.computed.series) {
        const summary = it.computed.series.summary;
        return `<section class="card">
          <h2>${title}</h2>
          <p class="meta">${desc}</p>
          ${summary ? `<p class="value">${esc(summary.op)} <strong>${formatValue(summary.value)}</strong></p>` : ""}
          ${chartSvg(it.computed.series)}
        </section>`;
      }
      return `<section class="card">
        <h2>${title}</h2>
        <p class="meta">${desc}</p>
        <p class="value"><strong>${formatValue(it.computed.value)}</strong></p>
      </section>`;
    })
    .join("\n");

  const printScript = opts.autoPrint
    ? `<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},200)});</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" data-brand="summit">
<head>
<meta charset="utf-8" />
<title>${esc(board.title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  :root {
    --paper: #eef3f9;
    --ink: #102a47;
    --brand: #174a7a;
    --foil: #1fc5d9;
    --mute: #5a6f86;
    --line: #c5d0dc;
  }
  body {
    font-family: Arimo, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: var(--paper);
    margin: 0;
    padding: 24px;
  }
  .masthead {
    border-bottom: 2px solid var(--brand);
    padding-bottom: 14px;
    margin-bottom: 20px;
  }
  .brand {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--brand);
    margin: 0;
  }
  h1 { font-size: 22px; font-weight: 600; margin: 8px 0 6px; color: var(--ink); }
  .stamp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }
  .stamp {
    font-size: 12px;
    color: var(--mute);
    margin: 0;
  }
  .chip {
    display: inline-block;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid var(--foil);
    color: var(--brand);
    padding: 2px 8px;
    border-radius: 999px;
  }
  .card { break-inside: avoid; margin: 0 0 18px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  h2 { font-size: 15px; margin: 0 0 4px; font-weight: 600; }
  .meta { font-size: 12px; color: var(--mute); margin: 0 0 8px; }
  .value { font-size: 18px; margin: 0 0 8px; }
  footer {
    margin-top: 28px;
    font-size: 10px;
    color: var(--mute);
    border-top: 1px solid var(--line);
    padding-top: 10px;
  }
  .no-print { margin: 0 0 16px; }
  @media print {
    .no-print { display: none !important; }
    body { background: white; padding: 0; }
  }
</style>
</head>
<body>
  <p class="no-print stamp">
    Print dialog opens automatically — choose <strong>Save as PDF</strong>.
    <button type="button" onclick="window.print()">Print again</button>
  </p>
  <header class="masthead">
    <p class="brand">Summit Treasury</p>
    <h1>${esc(board.title)}</h1>
    <div class="stamp-row">
      <p class="stamp">As of ${esc(as_of)}</p>
      <span class="chip">Reviewed</span>
      <p class="stamp">Shared by your Summit operator</p>
    </div>
    ${board.description ? `<p class="meta">${esc(board.description)}</p>` : ""}
  </header>
  ${sections}
  <footer>
    Advisory only — not investment, tax, or legal advice. Figures reflect your ledger as of the last import.
    Accuracy depends on the completeness of imported transactions. Summit does not take custody of client funds.
  </footer>
  ${printScript}
</body>
</html>`;
}
