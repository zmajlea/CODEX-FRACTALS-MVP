"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReviewSnapshot } from "@/lib/treasury/review-assemble";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";
import type { MetricSeries } from "@/lib/treasury/metrics-eval";
import { TreasuryClientRecommendations } from "@/components/treasury/TreasuryClientRecommendations";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";

type ReviewListItem = {
  id: string;
  title: string;
  period_month: string;
  status: string;
  current_version: number;
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

export function ClientReviewView({ tenantName }: Props) {
  const theme = useBcnThemeOptional();
  const brandLabel = theme?.wordmark?.trim() || tenantName || null;
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReview = useCallback(async (reviewId: string) => {
    const res = await fetch(`/api/treasury/reviews/${reviewId}`);
    if (!res.ok) throw new Error("Failed to load review");
    const json = (await res.json()) as {
      current?: { snapshot: ReviewSnapshot; change_note: string } | null;
    };
    setSnapshot(json.current?.snapshot ?? null);
    setChangeNote(json.current?.change_note ?? "");
  }, []);

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

  async function pickReview(id: string) {
    setActiveId(id);
    try {
      await loadReview(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load issue");
    }
  }

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

  const narrativeIds = snapshot.blocks
    .filter((b) => b.role === "narrative" && b.recommendation_id)
    .map((b) => String(b.recommendation_id));

  return (
    <div className="review-client">
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

      <header className="panel p-4 mb-4">
        <p className="eyebrow">{brandLabel ? `${brandLabel} · ` : ""}Treasury Review</p>
        <h1 className="title text-xl">{snapshot.meta.title}</h1>
        <p className="treasury-meta text-sm">
          Reviewed as of {snapshot.meta.reviewed_as_of} · Version {snapshot.meta.version}
        </p>
        {changeNote || snapshot.meta.change_note ? (
          <p className="panel-note mt-2 text-sm">{changeNote || snapshot.meta.change_note}</p>
        ) : null}
      </header>

      {snapshot.cover_figures.length ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
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

      <div className="space-y-4">
        {snapshot.blocks.map((block, i) => {
          const role = String(block.role);
          if (role === "exhibit") {
            const computed = block.computed as {
              kind?: string;
              series?: MetricSeries;
              value?: number;
            } | null;
            return (
              <section key={i} className="panel p-4">
                <h2 className="sec-title">{String(block.name ?? "Exhibit")}</h2>
                {block.caption ? (
                  <p className="treasury-meta text-sm mb-2">{String(block.caption)}</p>
                ) : null}
                {computed?.kind === "analytics" && computed.series ? (
                  <MetricChart
                    points={computed.series.points}
                    referenceLines={computed.series.reference_lines}
                    chartHint={computed.series.chart_hint}
                  />
                ) : computed?.value != null ? (
                  <p className="font-medium">{fmtMoney(computed.value)}</p>
                ) : (
                  <p className="treasury-meta text-sm">Chart unavailable</p>
                )}
              </section>
            );
          }
          if (role === "note") {
            return (
              <section key={i} className="panel p-4">
                {block.title ? <h2 className="sec-title">{String(block.title)}</h2> : null}
                <p className="text-sm whitespace-pre-wrap">{String(block.body ?? "")}</p>
              </section>
            );
          }
          if (role === "narrative" && block.recommendation_id) {
            return (
              <section key={i} className="panel p-4">
                <h2 className="sec-title">{String(block.title ?? "")}</h2>
                <p className="text-sm mb-3">{String(block.body ?? "")}</p>
                <TreasuryClientRecommendations
                  filterIds={[String(block.recommendation_id)]}
                  inline
                />
              </section>
            );
          }
          if (role === "figure") {
            return (
              <section key={i} className="panel p-4">
                <h2 className="sec-title">{String(block.label ?? "Figure")}</h2>
                <p className="font-medium text-lg">{fmtMoney(Number(block.value ?? 0))}</p>
                {block.caption ? (
                  <p className="treasury-meta text-sm">{String(block.caption)}</p>
                ) : null}
              </section>
            );
          }
          return null;
        })}
      </div>

      {narrativeIds.length === 0 ? (
        <div className="mt-6">
          <TreasuryClientRecommendations />
        </div>
      ) : null}

      <footer className="mt-8 text-xs text-codex-muted space-y-1">
        <p>{snapshot.disclosures.advisory}</p>
        <p>{snapshot.disclosures.accuracy}</p>
        <p>{snapshot.disclosures.review}</p>
      </footer>
    </div>
  );
}
