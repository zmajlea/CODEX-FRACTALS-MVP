"use client";

import { useEffect, useRef, useState } from "react";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import {
  LAYOUT_PRESETS,
  gridColumnSpan,
  resolveLayout,
  type ReviewBlockLayout,
} from "@/lib/treasury/review-block-layout";
import {
  emptyStudyPageComposite,
  newCompositeId,
  type StudyCompositeExhibit,
  type StudyCompositeNote,
  type StudyPageComposite,
} from "@/lib/treasury/study-page-composite";

export type StudyCanvasKpi = {
  id: string;
  label: string;
  value: string;
  unit: string;
  layout: ReviewBlockLayout;
};

export type StudyCanvasState = {
  kpis: StudyCanvasKpi[];
  exhibits: StudyCompositeExhibit[];
  notes: StudyCompositeNote[];
};

type MetricRow = {
  id: string;
  name: string;
  kind: string;
};

type Props = {
  clientUserId: string;
  name: string;
  typeLabel: string;
  openingBalance: string;
  onNameChange: (v: string) => void;
  onTypeLabelChange: (v: string) => void;
  onOpeningBalanceChange: (v: string) => void;
  value: StudyCanvasState;
  onChange: (next: StudyCanvasState) => void;
  disabled?: boolean;
  /** Full-screen overlay header actions (B17F1). */
  onSave?: () => void;
  onClose?: () => void;
  saving?: boolean;
  openingBalanceSource?: "ledger" | "manual" | "unknown";
  onNewMetric?: () => void;
};

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

const BLOCK_COUNT = (v: StudyCanvasState) =>
  v.kpis.length + v.exhibits.length + v.notes.length;

/** B17F1 — study builder as a full-width page (canvas + shelf), Summit mockup fidelity. */
export function StudyAuthorCanvas({
  clientUserId,
  name,
  typeLabel,
  openingBalance,
  onNameChange,
  onTypeLabelChange,
  onOpeningBalanceChange,
  value,
  onChange,
  disabled,
  onSave,
  onClose,
  saving,
  openingBalanceSource = "ledger",
  onNewMetric,
}: Props) {
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [bp, setBp] = useState<"desktop" | "tablet" | "phone">("desktop");
  const [adding, setAdding] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const base = `/api/operator/treasury/clients/${clientUserId}`;
  const empty = BLOCK_COUNT(value) === 0;

  useEffect(() => {
    void fetch(`${base}/metrics`)
      .then((r) => r.json())
      .then((j: { metrics?: MetricRow[] }) => setMetrics(j.metrics ?? []))
      .catch(() => setMetrics([]));
  }, [base]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      if (w < 720) setBp("phone");
      else if (w < 1040) setBp("tablet");
      else setBp("desktop");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && onClose) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setKpiLayout(id: string, layout: ReviewBlockLayout) {
    onChange({
      ...value,
      kpis: value.kpis.map((k) => (k.id === id ? { ...k, layout } : k)),
    });
  }
  function setExhibitLayout(id: string, layout: ReviewBlockLayout) {
    onChange({
      ...value,
      exhibits: value.exhibits.map((e) => (e.id === id ? { ...e, layout } : e)),
    });
  }
  function setNoteLayout(id: string, layout: ReviewBlockLayout) {
    onChange({
      ...value,
      notes: value.notes.map((n) => (n.id === id ? { ...n, layout } : n)),
    });
  }
  function addBlankKpi() {
    onChange({
      ...value,
      kpis: [
        ...value.kpis,
        { id: newCompositeId("kpi"), label: "", value: "", unit: "", layout: { w: 3, h: 1 } },
      ],
    });
  }
  function addNote() {
    onChange({
      ...value,
      notes: [
        ...value.notes,
        { id: newCompositeId("note"), body: "", layout: { w: 4, h: 1 } },
      ],
    });
  }

  async function placeMetric(metricId: string, as: "figure" | "exhibit") {
    setAdding(metricId);
    try {
      const res = await fetch(`${base}/metrics/${metricId}/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        error?: string;
        kind?: string;
        value?: number;
        points?: Array<{ bucket_start: string; bucket_label: string; value: number; partial?: boolean }>;
        series?: {
          points?: Array<{ bucket_start: string; bucket_label: string; value: number; partial?: boolean }>;
          reference_lines?: Array<{ label: string; value: number; kind?: string }>;
          chart_hint?: string;
          summary?: { value?: number };
        };
        reference_lines?: Array<{ label: string; value: number; kind?: string }>;
        chart_hint?: string;
        summary?: { value?: number };
        name?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Compute failed");
      const metric = metrics.find((m) => m.id === metricId);
      const title = metric?.name ?? "Metric";
      const points = json.series?.points ?? json.points ?? [];
      const refs = json.series?.reference_lines ?? json.reference_lines ?? [];
      const chartHint = json.series?.chart_hint ?? json.chart_hint;
      const summary =
        typeof json.value === "number"
          ? json.value
          : typeof json.series?.summary?.value === "number"
            ? json.series.summary.value
            : typeof json.summary?.value === "number"
              ? json.summary.value
              : null;

      if (as === "figure" || !points.length) {
        onChange({
          ...value,
          kpis: [
            ...value.kpis,
            {
              id: newCompositeId("kpi"),
              label: title,
              value: String(summary ?? 0),
              unit: "usd",
              layout: { w: 3, h: 1 },
            },
          ],
        });
        return;
      }
      const exhibit: StudyCompositeExhibit = {
        id: newCompositeId("exhibit"),
        title,
        chart_hint: chartHint === "line" ? "line" : "column",
        series_kind: "analytics",
        points: points.map((p) => ({
          label: p.bucket_label || p.bucket_start || "point",
          value: p.value,
        })),
        reference_lines: refs.map((r) => ({
          label: r.label,
          value: r.value,
          breach: r.kind === "threshold" ? true : undefined,
        })),
        layout: { w: 12, h: 2 },
      };
      onChange({ ...value, exhibits: [...value.exhibits, exhibit] });
    } catch {
      /* parent surfaces errors via save path */
    } finally {
      setAdding(null);
    }
  }

  const SizePresets = ({
    layout,
    onPick,
  }: {
    layout: ReviewBlockLayout;
    onPick: (l: ReviewBlockLayout) => void;
  }) => (
    <span className="sz" role="group" aria-label="Block size">
      {LAYOUT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`tool${layout.w === p.w ? " primary" : ""}`}
          disabled={disabled}
          onClick={() => onPick({ w: p.w, h: p.h })}
        >
          {p.label}
        </button>
      ))}
    </span>
  );

  const filtered = metrics.filter((m) =>
    search.trim() ? m.name.toLowerCase().includes(search.trim().toLowerCase()) : true
  );

  return (
    <div className="sb-root" data-bp={bp} role="dialog" aria-modal="true" aria-label="Study builder">
      <style>{SB_CSS}</style>
      <div className="sb-scrim" onClick={onClose} />
      <div className="sb-stage" ref={stageRef}>
        {/* ---- document column ---- */}
        <div className="sb-doc">
          <div className="sb-topline">
            <span className="pill">● Draft study</span>
            <span className="cnt">never client-visible until placed &amp; published</span>
            <span className="cnt">
              · <b>{BLOCK_COUNT(value)}</b> block{BLOCK_COUNT(value) === 1 ? "" : "s"}
            </span>
            <span className="grow" />
            <button type="button" className="tool" disabled={disabled} onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={disabled || saving}
              onClick={onSave}
            >
              {saving ? "Saving…" : "Save study"}
            </button>
          </div>

          <div className="sb-paper">
            <div className="sb-head">
              <div>
                <div className="kicker">
                  Study ·{" "}
                  <input
                    className="tl-in"
                    value={typeLabel}
                    placeholder="Working capital"
                    disabled={disabled}
                    onChange={(e) => onTypeLabelChange(e.target.value)}
                  />
                </div>
                <input
                  className="s-title"
                  value={name}
                  placeholder="Name this study"
                  disabled={disabled}
                  onChange={(e) => onNameChange(e.target.value)}
                />
                <div className="s-meta">
                  As of today · placed as <span className="chip">role: study</span> ·{" "}
                  {empty ? "empty page" : `${BLOCK_COUNT(value)} placed`}
                </div>
              </div>

              <div className="ob">
                <div className="ob-l">
                  Opening balance
                  <span className={`chip${openingBalanceSource === "manual" ? " on" : ""}`}>
                    {openingBalanceSource === "manual"
                      ? "manual"
                      : openingBalanceSource === "unknown"
                        ? "unknown"
                        : "from ledger"}
                  </span>
                </div>
                <div className="ob-f">
                  <span className="cur">$</span>
                  <input
                    value={openingBalance}
                    placeholder="0"
                    disabled={disabled}
                    onChange={(e) => onOpeningBalanceChange(e.target.value)}
                  />
                </div>
                <div className="ob-s">Optional · overrides the ledger buffer when set.</div>
              </div>
            </div>

            <div className="sb-canvas">
              {empty ? (
                <div className="empty">
                  <div className="kicker" style={{ color: "var(--sb-mute)" }}>
                    Nothing on the page yet
                  </div>
                  <h3>Build this study like a page</h3>
                  <p>
                    Add a metric from the shelf — narrow cards read as figures, wide cards draw as
                    charts. Write text between them. Everything is computed against the ledger and
                    freezes when the study is placed on an issue.
                  </p>
                  <div className="ecards">
                    <button className="ecard" type="button" disabled={disabled} onClick={onNewMetric}>
                      <b>Compose a metric</b>
                      <span>“sum of checks, by week, vs last year” — draws live</span>
                    </button>
                    <button className="ecard" type="button" disabled={disabled} onClick={addNote}>
                      <b>Write text</b>
                      <span>Inline, on the page</span>
                    </button>
                    <button className="ecard" type="button" disabled={disabled} onClick={addBlankKpi}>
                      <b>Add a figure</b>
                      <span>A headline number tile</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid">
                  {value.kpis.map((k) => {
                    const layout = resolveLayout(k.layout);
                    const span = gridColumnSpan(layout, bp);
                    return (
                      <article
                        key={k.id}
                        className="blk fig"
                        data-role="figure"
                        style={{ gridColumn: `span ${span}` }}
                      >
                        <div className="blk-chrome">
                          <span className="chip role">kpi</span>
                          <SizePresets layout={layout} onPick={(l) => setKpiLayout(k.id, l)} />
                          <span className="grow" />
                          <button
                            type="button"
                            className="tool danger"
                            disabled={disabled}
                            onClick={() =>
                              onChange({ ...value, kpis: value.kpis.filter((x) => x.id !== k.id) })
                            }
                          >
                            Remove
                          </button>
                        </div>
                        <div className="blk-body">
                          <input
                            className="tile-l-in"
                            placeholder="LABEL"
                            value={k.label}
                            disabled={disabled}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                kpis: value.kpis.map((x) =>
                                  x.id === k.id ? { ...x, label: e.target.value } : x
                                ),
                              })
                            }
                          />
                          <div className="tile-n">
                            {Number.isFinite(Number(k.value))
                              ? money(Number(k.value))
                              : k.value || "—"}
                          </div>
                          <input
                            className="tile-v-in"
                            placeholder="Value"
                            value={k.value}
                            disabled={disabled}
                            onChange={(e) =>
                              onChange({
                                ...value,
                                kpis: value.kpis.map((x) =>
                                  x.id === k.id ? { ...x, value: e.target.value } : x
                                ),
                              })
                            }
                          />
                        </div>
                      </article>
                    );
                  })}

                  {value.exhibits.map((e) => {
                    const layout = resolveLayout(e.layout);
                    const span = gridColumnSpan(layout, bp);
                    const asChart = layout.w >= 6;
                    const points = e.points.map((p) =>
                      "label" in p && "value" in p
                        ? { bucket_start: p.label, bucket_label: p.label, value: p.value }
                        : { bucket_start: `${p.month}-01`, bucket_label: p.month, value: p.ending }
                    );
                    return (
                      <article
                        key={e.id}
                        className="blk ex"
                        data-role={asChart ? "exhibit" : "figure"}
                        style={{ gridColumn: `span ${span}` }}
                      >
                        <div className="blk-chrome">
                          <span className="chip role">exhibit</span>
                          <SizePresets layout={layout} onPick={(l) => setExhibitLayout(e.id, l)} />
                          <span className="grow" />
                          <button
                            type="button"
                            className="tool danger"
                            disabled={disabled}
                            onClick={() =>
                              onChange({
                                ...value,
                                exhibits: value.exhibits.filter((x) => x.id !== e.id),
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                        <div className="blk-body">
                          <div className="ex-t">
                            <h3>{e.title}</h3>
                          </div>
                          {asChart && points.length ? (
                            <div className="ex-c">
                              <MetricChart
                                points={points}
                                referenceLines={e.reference_lines.map((r, i) => ({
                                  id: `r-${i}`,
                                  label: r.label,
                                  value: r.value,
                                  kind: r.breach ? "threshold" : "ref",
                                }))}
                                chartHint={e.chart_hint === "line" ? "line" : "column"}
                                height={200}
                              />
                            </div>
                          ) : (
                            <div className="tile-n">
                              {points.length ? money(points[points.length - 1]!.value) : "—"}
                              <span className="fighint"> · summary</span>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  {value.notes.map((n) => {
                    const layout = resolveLayout(n.layout);
                    const span = gridColumnSpan(layout, bp);
                    return (
                      <article
                        key={n.id}
                        className="blk txtblk"
                        data-role="note"
                        style={{ gridColumn: `span ${span}` }}
                      >
                        <div className="blk-chrome">
                          <span className="chip role">note</span>
                          <SizePresets layout={layout} onPick={(l) => setNoteLayout(n.id, l)} />
                          <span className="grow" />
                          <button
                            type="button"
                            className="tool danger"
                            disabled={disabled}
                            onClick={() =>
                              onChange({ ...value, notes: value.notes.filter((x) => x.id !== n.id) })
                            }
                          >
                            Remove
                          </button>
                        </div>
                        <textarea
                          className="txt"
                          rows={3}
                          value={n.body}
                          disabled={disabled}
                          placeholder="Write inline on the page…"
                          onChange={(e) =>
                            onChange({
                              ...value,
                              notes: value.notes.map((x) =>
                                x.id === n.id ? { ...x, body: e.target.value } : x
                              ),
                            })
                          }
                        />
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="addbar">
              <span className="kicker">Add</span>
              <button type="button" className="tool" disabled={disabled} onClick={addNote}>
                + Text
              </button>
              <button type="button" className="tool" disabled={disabled} onClick={addBlankKpi}>
                + Figure
              </button>
              {onNewMetric ? (
                <button type="button" className="tool" disabled={disabled} onClick={onNewMetric}>
                  + New metric
                </button>
              ) : null}
              <span className="hint">Cards snap to a 12-column grid · resize with the presets</span>
            </div>
          </div>
        </div>

        {/* ---- shelf column ---- */}
        <div className="sb-shelf-col">
          <div className="sb-shelf">
            <div className="sh-h">
              <span className="kicker">The shelf</span>
              <span className="chip">never client-visible</span>
            </div>
            <div className="sh-sub">
              <input
                placeholder="Search metrics…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="sh-list">
              <div className="sh-k">
                Metric library <span className="n">· {filtered.length}</span>
              </div>
              {filtered.map((m) => (
                <div className="sitem" key={m.id}>
                  <div className="si-t">
                    {m.name}
                    <span className="chip">{m.kind}</span>
                  </div>
                  <div className="si-m">Compute against the ledger</div>
                  <div className="si-act">
                    <button
                      type="button"
                      className="tool"
                      disabled={disabled || adding === m.id}
                      onClick={() => void placeMetric(m.id, "figure")}
                    >
                      Figure
                    </button>
                    <button
                      type="button"
                      className="tool"
                      disabled={disabled || adding === m.id}
                      onClick={() => void placeMetric(m.id, "exhibit")}
                    >
                      Exhibit
                    </button>
                  </div>
                </div>
              ))}
              {!filtered.length ? (
                <p className="rcx-muted" style={{ fontSize: 11, padding: "6px 4px" }}>
                  No metrics{search ? " match" : " yet"} — add figures or a note manually.
                </p>
              ) : null}

              <div className="sh-k" style={{ marginTop: 10 }}>
                Page blocks
              </div>
              <div className="sitem tile" onClick={disabled ? undefined : addNote}>
                <div className="ico">¶</div>
                <div className="si-t">Text</div>
                <div className="si-m">Headline, paragraph, callout — inline on the page</div>
              </div>
              <div className="sitem tile" onClick={disabled ? undefined : addBlankKpi}>
                <div className="ico">#</div>
                <div className="si-t">Figure</div>
                <div className="si-m">A headline number tile</div>
              </div>
            </div>
            {onNewMetric ? (
              <div className="sh-f">
                <button type="button" className="btn primary" disabled={disabled} onClick={onNewMetric}>
                  + New metric
                </button>
                <span className="meta rcx-muted">Opens the composer. Never client-visible.</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const SB_CSS = `
.sb-root{position:fixed;inset:0;z-index:120;--sb-canvas:#eef3f9;--sb-paper:#fff;--sb-edge:#dde7f3;--sb-ink:#102a47;--sb-slate:#364657;--sb-mute:#546480;--sb-line:#dde7f3;--sb-brand:#174a7a;--sb-accent:#1fc5d9;--sb-shadow:0 8px 26px rgba(16,42,71,.08);--sb-row:20px;--sb-gap:12px;font-family:var(--font-ui,'Arimo',Arial,sans-serif);color:var(--sb-ink)}
.sb-root .sb-scrim{position:absolute;inset:0;background:rgba(16,42,71,.34)}
.sb-root .sb-stage{position:absolute;inset:0;overflow:auto;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;max-width:1560px;margin:0 auto;padding:18px 22px 60px;align-items:start;background:var(--sb-canvas)}
.sb-root[data-bp="tablet"] .sb-stage{grid-template-columns:minmax(0,1fr) 280px}
.sb-root[data-bp="phone"] .sb-stage{grid-template-columns:minmax(0,1fr);padding:10px}
.sb-root[data-bp="phone"] .sb-shelf-col{position:static}
.sb-root .sb-doc{min-width:0}
.sb-root .sb-topline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;min-height:36px}
.sb-root .sb-topline .grow{flex:1}
.sb-root .sb-topline .cnt{font-size:12px;color:var(--sb-mute)} .sb-root .sb-topline .cnt b{color:var(--sb-ink)}
.sb-root .pill{font-size:11px;font-weight:700;color:var(--sb-brand);background:color-mix(in srgb,var(--sb-brand) 8%,var(--sb-paper));border:1px solid color-mix(in srgb,var(--sb-brand) 20%,var(--sb-line));border-radius:999px;padding:3px 10px}
.sb-root .sb-paper{background:var(--sb-paper);border:1px solid var(--sb-edge);border-radius:8px;box-shadow:var(--sb-shadow);padding:26px 32px 24px;min-height:560px}
.sb-root .sb-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 24px;align-items:start;padding-bottom:16px;border-bottom:1px solid var(--sb-line);margin-bottom:18px}
.sb-root[data-bp="phone"] .sb-head{grid-template-columns:minmax(0,1fr)}
.sb-root .kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--sb-mute);font-weight:700;display:flex;align-items:center;gap:8px}
.sb-root .tl-in{font:inherit;text-transform:none;letter-spacing:0;font-weight:600;color:var(--sb-slate);border:0;border-bottom:1px dashed var(--sb-edge);background:transparent;min-width:120px;outline:none;padding:0 2px}
.sb-root .tl-in:focus{border-bottom-color:var(--sb-accent)}
.sb-root .s-title{display:block;font-size:26px;font-weight:700;color:var(--sb-ink);letter-spacing:-.01em;line-height:1.2;border:0;background:transparent;width:100%;outline:none;margin:6px 0 4px;padding:2px 0}
.sb-root .s-title::placeholder{color:var(--sb-mute);font-weight:400}
.sb-root .s-meta{font-size:12.5px;color:var(--sb-mute);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sb-root .chip{font-size:10.5px;font-weight:700;color:var(--sb-mute);background:var(--sb-canvas);border:1px solid var(--sb-line);border-radius:999px;padding:2px 8px;letter-spacing:.02em}
.sb-root .chip.on{color:var(--sb-brand);border-color:color-mix(in srgb,var(--sb-brand) 30%,var(--sb-line));background:color-mix(in srgb,var(--sb-brand) 8%,var(--sb-paper))}
.sb-root .chip.role{text-transform:uppercase}
.sb-root .ob{background:var(--sb-canvas);border:1px solid var(--sb-line);border-radius:8px;padding:12px 14px;min-width:250px}
.sb-root .ob-l{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--sb-mute);font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}
.sb-root .ob-f{display:flex;align-items:baseline;gap:4px;margin:8px 0 6px}
.sb-root .ob-f .cur{font-size:18px;color:var(--sb-mute);font-weight:600}
.sb-root .ob input{font-size:24px;font-weight:700;color:var(--sb-ink);border:0;border-bottom:1px dashed var(--sb-edge);background:transparent;width:150px;padding:0 2px;outline:none;font-variant-numeric:tabular-nums}
.sb-root .ob input:focus{border-bottom-color:var(--sb-accent)}
.sb-root .ob-s{font-size:11.5px;color:var(--sb-mute)}
.sb-root .sb-canvas{position:relative;min-height:300px}
.sb-root .grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:minmax(112px,auto);gap:var(--sb-gap);grid-auto-flow:row dense;align-items:stretch}
.sb-root .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:2px dashed var(--sb-canvas);border-color:#c9d8ec;border-radius:8px;background:color-mix(in srgb,var(--sb-canvas) 55%,transparent);padding:44px 30px;min-height:340px}
.sb-root .empty h3{font-size:20px;margin:8px 0 6px}
.sb-root .empty p{color:var(--sb-mute);margin:0 0 16px;max-width:470px;font-size:13px;line-height:1.55}
.sb-root .empty .ecards{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.sb-root .empty .ecard{background:var(--sb-paper);border:1px solid var(--sb-edge);border-radius:10px;padding:12px 16px;cursor:pointer;text-align:left;min-width:190px;font:inherit;transition:border-color .15s,transform .12s,box-shadow .15s}
.sb-root .empty .ecard:hover{border-color:var(--sb-accent);transform:translateY(-1px);box-shadow:var(--sb-shadow)}
.sb-root .empty .ecard b{display:block;color:var(--sb-brand);font-size:13.5px}
.sb-root .empty .ecard span{font-size:12px;color:var(--sb-mute)}
.sb-root .blk{position:relative;background:var(--sb-paper);border:1px solid var(--sb-edge);border-radius:8px;padding:10px 12px;min-width:0;display:flex;flex-direction:column;transition:box-shadow .15s,border-color .15s}
.sb-root .blk:hover{border-color:color-mix(in srgb,var(--sb-brand) 35%,var(--sb-line));box-shadow:var(--sb-shadow)}
.sb-root .blk.txtblk{background:transparent;border-style:dashed;border-color:#c9d8ec}
.sb-root .blk-chrome{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;min-height:22px}
.sb-root .blk-chrome .grow{flex:1}
.sb-root .blk-body{flex:1;min-height:0;display:flex;flex-direction:column}
.sb-root .sz{display:inline-flex;gap:2px}
.sb-root .tool{font:inherit;font-size:11px;font-weight:600;color:var(--sb-slate);background:var(--sb-paper);border:1px solid var(--sb-line);border-radius:6px;padding:3px 8px;cursor:pointer;transition:border-color .12s,background .12s}
.sb-root .tool:hover:not(:disabled){border-color:var(--sb-accent)}
.sb-root .tool.primary{background:var(--sb-brand);color:#fff;border-color:var(--sb-brand)}
.sb-root .tool.danger:hover:not(:disabled){border-color:var(--sb-neg,#b23a2e);color:var(--sb-neg,#b23a2e)}
.sb-root .tool:disabled{opacity:.5;cursor:default}
.sb-root .sz .tool{padding:2px 7px;font-size:10.5px}
.sb-root .btn{font:inherit;font-size:13px;font-weight:700;border-radius:8px;padding:7px 14px;cursor:pointer;border:1px solid var(--sb-line);background:var(--sb-paper);color:var(--sb-ink)}
.sb-root .btn.primary{background:var(--sb-brand);color:#fff;border-color:var(--sb-brand)}
.sb-root .btn:disabled{opacity:.55;cursor:default}
.sb-root .tile-l-in{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--sb-mute);font-weight:600;border:0;background:transparent;width:100%;outline:none;padding:0}
.sb-root .tile-v-in{font-size:12px;color:var(--sb-slate);border:0;border-top:1px dashed var(--sb-edge);background:transparent;width:100%;outline:none;margin-top:6px;padding-top:4px}
.sb-root .tile-n{font-size:clamp(22px,2.4vw,30px);font-weight:700;color:var(--sb-ink);margin-top:4px;line-height:1;font-variant-numeric:tabular-nums}
.sb-root .fighint{font-size:11px;color:var(--sb-mute);font-weight:400}
.sb-root .ex-t h3{font-size:14.5px;margin:0 0 4px}
.sb-root .ex-c{flex:1;min-height:160px;margin-top:4px}
.sb-root .txt{font:inherit;font-size:14px;line-height:1.55;color:var(--sb-ink);border:0;background:transparent;width:100%;outline:none;resize:vertical;flex:1}
.sb-root .addbar{display:flex;align-items:center;gap:8px;margin-top:18px;padding-top:14px;border-top:1px dashed #c9d8ec;flex-wrap:wrap}
.sb-root .addbar .hint{font-size:11.5px;color:var(--sb-mute);margin-left:auto}
.sb-root .sb-shelf-col{position:sticky;top:18px}
.sb-root .sb-shelf{background:var(--sb-paper);border:1px solid var(--sb-edge);border-radius:8px;box-shadow:var(--sb-shadow);display:flex;flex-direction:column;max-height:calc(100vh - 60px)}
.sb-root .sh-h{padding:12px 14px 10px;border-bottom:1px solid var(--sb-line);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sb-root .sh-h .chip{margin-left:auto}
.sb-root .sh-sub{padding:10px 12px 0}
.sb-root .sh-sub input{width:100%;font:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--sb-line);border-radius:6px;background:var(--sb-paper);outline:none}
.sb-root .sh-sub input:focus{border-color:var(--sb-accent)}
.sb-root .sh-list{overflow:auto;padding:8px 10px 10px;flex:1}
.sb-root .sh-k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--sb-mute);font-weight:700;padding:8px 4px 2px}
.sb-root .sh-k .n{font-weight:600;letter-spacing:0}
.sb-root .sitem{border:1px solid var(--sb-line);border-radius:8px;padding:8px 10px;margin-top:6px;background:var(--sb-paper);transition:border-color .15s,box-shadow .15s,transform .12s}
.sb-root .sitem:hover{border-color:var(--sb-accent);box-shadow:var(--sb-shadow);transform:translateY(-1px)}
.sb-root .sitem .si-t{font-size:13px;font-weight:700;color:var(--sb-ink);display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-root .sitem .si-t .chip{margin-left:auto}
.sb-root .sitem .si-m{font-size:11.5px;color:var(--sb-mute);margin-top:2px}
.sb-root .sitem .si-act{display:flex;gap:6px;margin-top:8px}
.sb-root .sitem.tile{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;border-style:dashed;cursor:pointer;align-items:center}
.sb-root .sitem.tile .ico{width:30px;height:30px;border-radius:7px;background:var(--sb-canvas);display:grid;place-items:center;color:var(--sb-brand);font-weight:700;font-size:15px;grid-row:1/span 2}
.sb-root .sitem.tile .si-m{white-space:normal}
.sb-root .sh-f{padding:10px 14px 12px;border-top:1px solid var(--sb-line);display:flex;flex-direction:column;gap:6px}
.sb-root .sh-f .btn{width:100%}
.sb-root .sh-f .meta{font-size:11px}
`;

/** Build results + composite for POST /studies (round-trip persistence). */
export function buildStudySavePayload(input: {
  name: string;
  openingBalance: string;
  canvas: StudyCanvasState;
}): { results: Record<string, unknown>; composite: StudyPageComposite } {
  const kpis = input.canvas.kpis
    .map((k) => ({
      id: k.id,
      label: k.label.trim(),
      value: Number.isFinite(Number(k.value)) ? Number(k.value) : k.value.trim(),
      unit: k.unit.trim() || undefined,
      layout: resolveLayout(k.layout),
    }))
    .filter((k) => k.label);

  const exhibits = input.canvas.exhibits.map((e) => ({
    ...e,
    layout: resolveLayout(e.layout),
  }));

  const notes = input.canvas.notes
    .map((n) => ({
      ...n,
      body: n.body.trim(),
      layout: resolveLayout(n.layout),
    }))
    .filter((n) => n.body);

  const scenarios = exhibits
    .filter((e) => e.series_kind !== "analytics")
    .map((e, i) => ({
      id: e.id,
      name: e.title || `Scenario ${i + 1}`,
      timeline: e.points
        .filter(
          (p): p is { month: string; ending: number; projected?: boolean } =>
            "month" in p && "ending" in p
        )
        .map((p, pi, pts) => {
          const prevEnding = pi > 0 ? pts[pi - 1]!.ending : p.ending;
          const beginning = pi === 0 ? p.ending : prevEnding;
          const net = p.ending - beginning;
          return {
            month: p.month.length === 7 ? `${p.month}-01` : p.month,
            beginning,
            net,
            ending: p.ending,
          };
        }),
      runway_months: null as number | null,
      breach_month: null as string | null,
    }));

  const results: Record<string, unknown> = {
    schema_version: "summit.results/v1",
    export_id: `manual-${Date.now()}`,
    as_of: new Date().toISOString().slice(0, 10),
    headline: input.name.trim(),
    kpis: kpis.map(({ label, value, unit }) => ({ label, value, unit })),
    scenarios,
    narrative: notes.map((n) => ({ heading: "note", body: n.body })),
    recommendations: [],
    actuals_check: [],
  };
  if (input.openingBalance.trim() && Number.isFinite(Number(input.openingBalance))) {
    results.opening_balance = Number(input.openingBalance);
  }

  const composite: StudyPageComposite = {
    exhibits,
    notes,
    kpiLayouts: kpis.map((k) => ({ id: k.id, layout: k.layout })),
  };

  return { results, composite };
}

export function canvasStateFromComposite(
  composite: StudyPageComposite | null | undefined,
  resultsKpis: Array<{ label: string; value: number | string; unit?: string }>
): StudyCanvasState {
  if (!composite) {
    return {
      kpis: resultsKpis.map((k, i) => ({
        id: `kpi-${i}`,
        label: k.label,
        value: String(k.value),
        unit: k.unit ?? "",
        layout: { w: 3, h: 1 },
      })),
      exhibits: [],
      notes: [],
    };
  }
  return {
    kpis: resultsKpis.map((k, i) => {
      const lay = composite.kpiLayouts[i];
      return {
        id: lay?.id ?? `kpi-${i}`,
        label: k.label,
        value: String(k.value),
        unit: k.unit ?? "",
        layout: resolveLayout(lay?.layout ?? { w: 3, h: 1 }),
      };
    }),
    exhibits: composite.exhibits ?? [],
    notes: composite.notes ?? [],
  };
}

export { emptyStudyPageComposite };
