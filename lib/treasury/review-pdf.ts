import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";
import { chartSvg } from "@/lib/treasury/analytics-pdf";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(v: number | string | undefined | null): string {
  if (v == null) return "—";
  if (typeof v === "string") return esc(v);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export type RenderReviewHtmlOptions = {
  autoPrint?: boolean;
};

/** Spec B12 — render frozen review snapshot for print/PDF export. */
export function renderReviewSnapshotHtml(
  snapshot: ReviewSnapshot,
  opts: RenderReviewHtmlOptions = {}
): string {
  const { meta, cover_figures, blocks, disclosures } = snapshot;

  const coverHtml = cover_figures
    .map(
      (f) => `<div class="cover-fig"><span class="label">${esc(f.label)}</span>
        <span class="value">${formatValue(f.value)}</span>
        ${f.caption ? `<p class="caption">${esc(f.caption)}</p>` : ""}</div>`
    )
    .join("");

  const blockHtml = blocks
    .map((b) => {
      const role = String(b.role ?? "");
      if (role === "figure") {
        return `<section class="card"><h2>${esc(String(b.label ?? "Figure"))}</h2>
          <p class="value">${formatValue(b.value as number)}</p>
          ${b.caption ? `<p class="caption">${esc(String(b.caption))}</p>` : ""}</section>`;
      }
      if (role === "exhibit") {
        const computed = b.computed as {
          kind?: string;
          series?: Parameters<typeof chartSvg>[0];
          value?: number;
        } | null;
        let chart = "";
        if (computed?.kind === "analytics" && computed.series) {
          chart = chartSvg(computed.series);
        }
        return `<section class="card"><h2>${esc(String(b.name ?? "Exhibit"))}</h2>
          ${b.caption ? `<p class="caption">${esc(String(b.caption))}</p>` : ""}
          ${chart}</section>`;
      }
      if (role === "note") {
        return `<section class="card note"><h2>${esc(String(b.title ?? "Note"))}</h2>
          <p>${esc(String(b.body ?? ""))}</p></section>`;
      }
      if (role === "narrative") {
        return `<section class="card narrative"><h2>${esc(String(b.title ?? ""))}</h2>
          <p>${esc(String(b.body ?? ""))}</p></section>`;
      }
      return "";
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${esc(meta.title)}</title>
<style>
  body{font-family:Georgia,serif;color:#1a1a1b;background:#fcfbf9;margin:24px;line-height:1.5}
  h1{font-size:1.5rem;margin:0 0 8px}
  .meta{color:#5a6f86;font-size:0.85rem;margin-bottom:24px}
  .change-note{background:#ded9d1;padding:12px;margin-bottom:24px;border-radius:4px}
  .cover{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  .cover-fig{background:#fff;border:1px solid #ded9d1;padding:12px;min-width:140px}
  .cover-fig .label{display:block;font-size:0.75rem;color:#5a6f86}
  .cover-fig .value{font-size:1.25rem;font-weight:600}
  .card{background:#fff;border:1px solid #ded9d1;padding:16px;margin-bottom:16px;border-radius:4px}
  .caption{color:#5a6f86;font-size:0.9rem}
  .disclosures{margin-top:32px;font-size:0.75rem;color:#5a6f86}
  @media print{body{margin:0}}
</style></head><body>
<h1>${esc(meta.title)}</h1>
<p class="meta">Reviewed as of ${esc(meta.reviewed_as_of)} · Version ${meta.version}</p>
${meta.change_note ? `<div class="change-note">${esc(meta.change_note)}</div>` : ""}
<div class="cover">${coverHtml}</div>
${blockHtml}
<div class="disclosures">
  <p>${esc(disclosures.advisory)}</p>
  <p>${esc(disclosures.accuracy)}</p>
  <p>${esc(disclosures.review)}</p>
</div>
${opts.autoPrint ? `<script>window.onload=()=>window.print()</script>` : ""}
</body></html>`;
}
