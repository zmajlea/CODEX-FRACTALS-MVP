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
function chartSvg(series: {
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
  if (hint === "line") {
    const pts = points
      .map((p, i) => `${padL + i * slot + slot / 2},${yAt(p.value)}`)
      .join(" ");
    body += `<polyline fill="none" stroke="#1A1A1B" stroke-width="1.5" points="${pts}" />`;
  } else {
    body += points
      .map((p, i) => {
        const x = padL + i * slot + (slot - barW) / 2;
        const y0 = yAt(0);
        const y1 = yAt(p.value);
        const top = Math.min(y0, y1);
        const h = Math.max(1, Math.abs(y1 - y0));
        const fill = (p.breaches?.length ?? 0) > 0 ? "#E67E50" : "#1A1A1B";
        return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" fill="${fill}" opacity="0.65" />`;
      })
      .join("");
  }
  for (const line of series.reference_lines ?? []) {
    const y = yAt(line.value);
    body += `<line x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}" stroke="#EBC06D" stroke-dasharray="4 3" />`;
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Spec B7 — branded HTML for portal print / Playwright PDF. */
export function renderAnalyticsBoardHtml(assembled: AssembledBoard): string {
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(board.title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1A1A1B; background: #FCFBF9; margin: 0; padding: 24px; }
  .masthead { border-bottom: 1px solid #DED9D1; padding-bottom: 12px; margin-bottom: 20px; }
  .brand { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #666; }
  h1 { font-size: 22px; font-weight: 600; margin: 6px 0 4px; }
  .stamp { font-size: 12px; color: #555; margin: 0; }
  .card { break-inside: avoid; margin: 0 0 18px; padding: 12px 0; border-bottom: 1px solid #DED9D1; }
  h2 { font-size: 15px; margin: 0 0 4px; font-weight: 600; }
  .meta { font-size: 12px; color: #666; margin: 0 0 8px; }
  .value { font-size: 18px; margin: 0 0 8px; }
  footer { margin-top: 28px; font-size: 10px; color: #666; border-top: 1px solid #DED9D1; padding-top: 10px; }
</style>
</head>
<body>
  <header class="masthead">
    <p class="brand">Summit Treasury</p>
    <h1>${esc(board.title)}</h1>
    <p class="stamp">As of ${esc(as_of)} · Reviewed and shared by your Summit operator</p>
    ${board.description ? `<p class="meta">${esc(board.description)}</p>` : ""}
  </header>
  ${sections}
  <footer>
    Advisory only — not investment, tax, or legal advice. Figures reflect your ledger as of the last import.
    Accuracy depends on the completeness of imported transactions.
  </footer>
</body>
</html>`;
}

export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
