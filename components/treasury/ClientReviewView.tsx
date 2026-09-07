"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import { MetricComparisonChart } from "@/components/operator/treasury/analytics/MetricComparisonChart";
import {
  MetricComparisonTable,
  MetricSeriesTable,
} from "@/components/operator/treasury/analytics/MetricTable";
import type { MetricComparison } from "@/lib/treasury/metrics-eval";
import type { MetricSeries } from "@/lib/treasury/metrics-eval";
import { TreasuryClientRecommendations } from "@/components/treasury/TreasuryClientRecommendations";
import { StudyBlockView } from "@/components/operator/treasury/StudyBlockView";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import {
  resolveLayout,
  renderMetricAsChart,
  summaryValueFromSnapshot,
} from "@/lib/treasury/review-block-layout";
import {
  collapseItemFromBlock,
  collapseLayoutUnits,
} from "@/lib/treasury/review-layout-collapse";

type ReviewListItem = {
  id: string;
  title: string;
  period_month: string;
  status: string;
  current_version: number;
};

type EditionMeta = {
  id: string;
  version: number;
  reviewed_as_of: string;
  published_at: string | null;
  change_note: string | null;
  label: string | null;
  window: { from?: string; to?: string } | null;
};

type Props = {
  /** @deprecated use theme wordmark — kept for callers without BcnThemeProvider */
  tenantName?: string | null;
};

function fmtMoney(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function blockTitle(block: Record<string, unknown>): string {
  const role = String(block.role ?? "");
  if (role === "figure") return String(block.label ?? "Figure");
  if (role === "exhibit") return String(block.name ?? "Exhibit");
  if (role === "note") return String(block.title || "Note");
  if (role === "narrative") return String(block.title ?? "Advisory");
  if (role === "study") return String(block.name ?? "Study");
  return role || "Block";
}

function editionCaption(ed: EditionMeta): string {
  const name = (ed.label ?? "").trim() || `Edition ${ed.version}`;
  const win =
    ed.window?.from && ed.window?.to
      ? ` · ${ed.window.from} → ${ed.window.to}`
      : "";
  return `${name}${win}`;
}

export function ClientReviewView({ tenantName }: Props) {
  const theme = useBcnThemeOptional();
  const brandLabel = theme?.wordmark?.trim() || tenantName || null;
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editions, setEditions] = useState<EditionMeta[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [editionLabel, setEditionLabel] = useState<string | null>(null);
  const [editionWindow, setEditionWindow] = useState<{
    from?: string;
    to?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bp, setBp] = useState<"desktop" | "phone">("desktop");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const loadReview = useCallback(
    async (reviewId: string, version?: number | null) => {
      const qs =
        version != null && Number.isFinite(version)
          ? `?version=${version}`
          : "";
      const res = await fetch(`/api/treasury/reviews/${reviewId}${qs}`);
      if (!res.ok) throw new Error("Failed to load review");
      const json = (await res.json()) as {
        current?: {
          snapshot: ReviewSnapshot;
          change_note: string;
          version?: number;
          label?: string | null;
          window?: { from?: string; to?: string } | null;
        } | null;
        editions?: EditionMeta[];
        history?: EditionMeta[];
      };
      const list = json.editions ?? json.history ?? [];
      setEditions(list);
      setSnapshot(json.current?.snapshot ?? null);
      setChangeNote(json.current?.change_note ?? "");
      setEditionLabel(json.current?.label ?? null);
      setEditionWindow(json.current?.window ?? null);
      setSelectedVersion(
        json.current?.version ??
          json.current?.snapshot?.meta?.version ??
          list[0]?.version ??
          null
      );
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/treasury/reviews");
      if (!res.ok) throw new Error("Failed to load reviews");
      const json = (await res.json()) as { reviews: ReviewListItem[] };
      setReviews(json.reviews ?? []);
      const first = json.reviews?.[0];
      if (first) {
        setActiveId(first.id);
        await loadReview(first.id);
      } else {
        setActiveId(null);
        setSnapshot(null);
        setEditions([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [loadReview]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setBp(w < 640 ? "phone" : "desktop");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [snapshot]);

  async function pickReview(id: string) {
    setActiveId(id);
    try {
      await loadReview(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load issue");
    }
  }

  async function pickEdition(version: number) {
    if (!activeId) return;
    try {
      await loadReview(activeId, version);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load edition");
    }
  }

  const selectedIdx = useMemo(() => {
    if (selectedVersion == null) return -1;
    return editions.findIndex((e) => e.version === selectedVersion);
  }, [editions, selectedVersion]);

  const contents = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.blocks.map((b, i) => ({
      i,
      title: blockTitle(b as Record<string, unknown>),
      role: String((b as { role?: string }).role ?? ""),
    }));
  }, [snapshot]);

  if (loading) return <p className="treasury-meta">Loading your review…</p>;
  if (error) {
    return (
      <p className="panel-note" style={{ color: "var(--su-neg)" }} role="alert">
        {error}
      </p>
    );
  }

  if (!reviews.length || !snapshot) {
    return (
      <div className="panel p-6">
        <p className="sec-title mb-2">No published review yet</p>
        <p className="treasury-meta text-sm">
          Your Summit operator will publish your first Monthly Treasury Review here.
        </p>
      </div>
    );
  }

  const blocks = snapshot.blocks as Array<Record<string, unknown>>;
  const collapseItems = blocks.map((b, i) => collapseItemFromBlock(b, i));
  const units = collapseLayoutUnits(collapseItems);

  function renderFigureBlock(block: Record<string, unknown>) {
    return (
      <div className="panel p-3">
        <p className="text-xs text-codex-muted">{String(block.label ?? "Figure")}</p>
        <p className="font-medium text-lg">{fmtMoney(Number(block.value ?? 0))}</p>
        {block.caption ? (
          <p className="text-xs mt-1">{String(block.caption)}</p>
        ) : null}
      </div>
    );
  }

  function renderExhibitBlock(block: Record<string, unknown>, forceTile: boolean) {
    const computed = block.computed as {
      kind?: string;
      series?: MetricSeries;
      comparison?: MetricComparison;
      value?: number;
    } | null;
    const layout = resolveLayout(block.layout);
    const snapForFlip = computed ?? block;
    const asChart = !forceTile && renderMetricAsChart(layout, snapForFlip);
    const viewMode = block.view_mode === "table" ? "table" : "chart";

    if (!asChart) {
      const summary =
        summaryValueFromSnapshot(snapForFlip) ??
        (typeof computed?.value === "number" ? computed.value : null) ??
        (typeof block.value === "number" ? Number(block.value) : null);
      return (
        <section className="panel p-4">
          <h2 className="sec-title">{String(block.name ?? block.label ?? "Figure")}</h2>
          <p className="font-medium text-lg">
            {summary != null ? fmtMoney(summary) : "—"}
          </p>
          {block.caption ? (
            <p className="treasury-meta text-sm">{String(block.caption)}</p>
          ) : null}
        </section>
      );
    }

    return (
      <section className="panel p-4">
        <h2 className="sec-title">{String(block.name ?? "Exhibit")}</h2>
        {block.caption ? (
          <p className="treasury-meta text-sm mb-2">{String(block.caption)}</p>
        ) : null}
        {computed?.kind === "comparison" && computed.comparison ? (
          viewMode === "table" ? (
            <MetricComparisonTable comparison={computed.comparison} />
          ) : (
            <MetricComparisonChart comparison={computed.comparison} />
          )
        ) : computed?.kind === "analytics" && computed.series ? (
          viewMode === "table" ? (
            <MetricSeriesTable
              points={computed.series.points}
              referenceLines={computed.series.reference_lines}
            />
          ) : (
            <MetricChart
              points={computed.series.points}
              referenceLines={computed.series.reference_lines}
              chartHint={computed.series.chart_hint}
            />
          )
        ) : computed?.value != null ? (
          <p className="font-medium">{fmtMoney(computed.value)}</p>
        ) : (
          <p className="treasury-meta text-sm">Chart unavailable</p>
        )}
      </section>
    );
  }

  function renderNoteBlock(block: Record<string, unknown>) {
    return (
      <section className="panel p-4">
        {block.title ? <h2 className="sec-title">{String(block.title)}</h2> : null}
        <p className="text-sm whitespace-pre-wrap">{String(block.body ?? "")}</p>
      </section>
    );
  }

  function renderBlock(index: number, forceTile = false) {
    const block = blocks[index];
    if (!block) return null;
    const role = String(block.role);
    if (role === "figure") return renderFigureBlock(block);
    if (role === "exhibit") return renderExhibitBlock(block, forceTile);
    if (role === "note") return renderNoteBlock(block);
    if (role === "narrative" && block.recommendation_id) {
      return (
        <section className="panel p-4">
          <h2 className="sec-title">{String(block.title ?? "")}</h2>
          <p className="text-sm mb-3">{String(block.body ?? "")}</p>
          <TreasuryClientRecommendations
            filterIds={[String(block.recommendation_id)]}
            inline
            readOnly
          />
        </section>
      );
    }
    if (role === "study") {
      const viewMode = block.view_mode === "table" ? "table" : "chart";
      return (
        <section className="panel p-4">
          <h2 className="sec-title">{String(block.name ?? "Study")}</h2>
          {block.caption ? (
            <p className="treasury-meta text-sm mb-2">{String(block.caption)}</p>
          ) : null}
          <StudyBlockView
            snapshot={block.computed ?? block}
            viewMode={viewMode}
            showProvenance={false}
          />
        </section>
      );
    }
    return null;
  }

  return (
    <div className="review-client" ref={rootRef} data-bp={bp}>
      <div className="flex flex-wrap gap-2 mb-4">
        {reviews.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`chip${activeId === r.id ? " on" : ""}`}
            onClick={() => void pickReview(r.id)}
          >
            {r.title || r.period_month}
          </button>
        ))}
        {activeId ? (
          <a
            className="chip"
            href={`/api/treasury/reviews/${activeId}/export?print=1`}
            target="_blank"
            rel="noreferrer"
          >
            Export PDF
          </a>
        ) : null}
      </div>

      {editions.length > 1 ? (
        <div
          className="panel p-3 mb-4 flex flex-wrap items-center gap-2"
          data-testid="editions-stepper"
        >
          <span className="text-xs uppercase tracking-wide text-codex-muted font-semibold">
            Editions
          </span>
          <button
            type="button"
            className="chip"
            disabled={selectedIdx <= 0}
            onClick={() => {
              const prev = editions[selectedIdx - 1];
              if (prev) void pickEdition(prev.version);
            }}
            aria-label="Newer edition"
          >
            ← Newer
          </button>
          <select
            className="chip"
            value={selectedVersion ?? ""}
            onChange={(e) => void pickEdition(Number(e.target.value))}
            aria-label="Select edition"
          >
            {editions.map((ed) => (
              <option key={ed.id} value={ed.version}>
                {editionCaption(ed)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chip"
            disabled={selectedIdx < 0 || selectedIdx >= editions.length - 1}
            onClick={() => {
              const next = editions[selectedIdx + 1];
              if (next) void pickEdition(next.version);
            }}
            aria-label="Older edition"
          >
            Older →
          </button>
        </div>
      ) : null}

      <header className="panel p-4 mb-4">
        <p className="eyebrow">{brandLabel ? `${brandLabel} · ` : ""}Treasury Review</p>
        <h1 className="title text-xl">{snapshot.meta.title}</h1>
        <p className="treasury-meta text-sm">
          {(editionLabel ?? "").trim() ||
            (selectedVersion != null
              ? `Edition ${selectedVersion}`
              : `Edition ${snapshot.meta.version}`)}
          {editionWindow?.from && editionWindow?.to
            ? ` · ${editionWindow.from} → ${editionWindow.to}`
            : ""}
          {" · "}
          Reviewed as of {snapshot.meta.reviewed_as_of}
        </p>
        {changeNote || snapshot.meta.change_note ? (
          <p className="panel-note mt-2 text-sm">{changeNote || snapshot.meta.change_note}</p>
        ) : null}
        {contents.length ? (
          <nav className="mt-3" aria-label="Contents">
            <p className="text-xs text-codex-muted uppercase tracking-wide font-semibold mb-1">
              Contents
            </p>
            <ol className="text-sm space-y-0.5 list-decimal list-inside">
              {contents.map((c) => (
                <li key={c.i}>
                  {c.title}
                  <span className="text-codex-muted"> · {c.role}</span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </header>

      {snapshot.cover_figures.length ? (
        <div
          className={`grid gap-3 mb-4 ${
            bp === "phone" ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"
          }`}
        >
          {snapshot.cover_figures.map((f, i) => (
            <div key={i} className="panel p-3">
              <p className="text-xs text-codex-muted">{f.label}</p>
              <p className="font-medium text-lg">
                {typeof f.value === "number" ? fmtMoney(f.value) : f.value}
              </p>
              {f.caption ? <p className="text-xs mt-1">{f.caption}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-4" data-testid="client-review-body">
        {units.map((u, ui) => {
          if (u.kind === "figrow") {
            const cols =
              bp === "phone" ? 2 : Math.min(4, Math.max(1, u.items.length));
            return (
              <div
                key={`fig-${ui}`}
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {u.items.map((it) => (
                  <div key={it.id}>{renderBlock(it.sourceIndex, true)}</div>
                ))}
              </div>
            );
          }
          if (u.kind === "r84") {
            return (
              <div
                key={`r84-${ui}`}
                className="grid gap-3"
                style={{
                  gridTemplateColumns: bp === "phone" ? "1fr" : "2fr 1fr",
                }}
              >
                <div>{renderBlock(u.primary.sourceIndex)}</div>
                <aside className="panel p-4" style={{ background: "color-mix(in srgb, #0e7490 7%, #fff)" }}>
                  {renderBlock(u.side.sourceIndex)}
                </aside>
              </div>
            );
          }
          if (u.kind === "r66") {
            return (
              <div
                key={`r66-${ui}`}
                className="grid gap-3"
                style={{
                  gridTemplateColumns: bp === "phone" ? "1fr" : "1fr 1fr",
                }}
              >
                <div>{renderBlock(u.left.sourceIndex)}</div>
                <div>{renderBlock(u.right.sourceIndex)}</div>
              </div>
            );
          }
          return <div key={`full-${ui}`}>{renderBlock(u.item.sourceIndex)}</div>;
        })}
      </div>

      <div className="mt-6 panel p-4" data-testid="advisory-thread">
        <h2 className="sec-title mb-2">Advisory</h2>
        <TreasuryClientRecommendations readOnly />
      </div>

      <footer className="mt-8 text-xs text-codex-muted space-y-1">
        <p>{snapshot.disclosures.advisory}</p>
        <p>{snapshot.disclosures.accuracy}</p>
        <p>{snapshot.disclosures.review}</p>
      </footer>
    </div>
  );
}
