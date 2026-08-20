"use client";

import { useCallback, useEffect, useState } from "react";
import { MetricChart } from "@/components/operator/treasury/analytics/MetricChart";

type BoardListItem = {
  id: string;
  title: string;
  description: string | null;
  shared_at: string | null;
};

type ClientAssembled = {
  board: {
    id: string;
    title: string;
    description: string;
    shared_at: string | null;
  };
  as_of: string;
  items: Array<{
    metric_id: string;
    missing: boolean;
    name: string;
    description: string;
    kind: string;
    computed: {
      kind: "value" | "analytics";
      value?: number;
      series?: {
        points: Array<{
          bucket_start: string;
          bucket_label: string;
          value: number;
          partial?: true;
          breaches?: string[];
        }>;
        reference_lines?: Array<{
          id: string;
          label: string;
          value: number;
          kind: string;
        }>;
        summary?: { op: string; value: number };
        chart_hint?: "column" | "line";
      };
      computed_at: string;
    } | null;
  }>;
  disclosures: {
    advisory: string;
    accuracy: string;
    review: string;
  };
};

function formatValue(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Spec B7 — client portal read-only shared analytics boards. */
export function ClientAnalyticsBoards() {
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [assembled, setAssembled] = useState<ClientAssembled | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/treasury/analytics");
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Failed to load");
      }
      const json = (await res.json()) as { boards?: BoardListItem[] };
      const list = json.boards ?? [];
      setBoards(list);
      if (list[0] && !activeId) setActiveId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    if (!activeId) {
      setAssembled(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/treasury/analytics/${activeId}`);
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Failed to open board");
        }
        const json = (await res.json()) as ClientAssembled;
        if (!cancelled) setAssembled(json);
      } catch (e) {
        if (!cancelled) {
          setAssembled(null);
          setError(e instanceof Error ? e.message : "Failed to open");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  if (loading) {
    return <p className="treasury-meta text-sm">Loading Analytics…</p>;
  }

  if (!boards.length) {
    return (
      <div className="space-y-2" data-testid="client-analytics-empty">
        <p className="sec-title mb-0">Analytics</p>
        <p className="treasury-meta text-sm">
          Nothing shared yet. Your Summit operator will publish a dashboard when
          it is ready for you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="client-analytics-boards">
      <div>
        <p className="sec-title mb-1">Analytics</p>
        <p className="treasury-meta text-sm mb-0">
          Live dashboards shared by your Summit team.
        </p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {boards.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              className="chip"
              data-active={activeId === b.id ? "true" : undefined}
              onClick={() => setActiveId(b.id)}
            >
              {b.title}
            </button>
          ))}
        </div>
      ) : null}

      {assembled ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium mb-1">{assembled.board.title}</h2>
            <p className="text-sm opacity-70 mb-0">
              As of {assembled.as_of} · {assembled.disclosures.review}
            </p>
            {assembled.board.description ? (
              <p className="text-sm mt-1 mb-0">{assembled.board.description}</p>
            ) : null}
          </div>
          {assembled.items.map((it) => (
            <section key={it.metric_id} className="space-y-1 border-t border-[var(--line,#DED9D1)] pt-3">
              <h3 className="font-medium mb-0">{it.name}</h3>
              <p className="text-sm opacity-70 mb-0">{it.description || "—"}</p>
              {it.missing || !it.computed ? (
                <p className="text-sm opacity-60">Unavailable</p>
              ) : it.computed.kind === "analytics" && it.computed.series ? (
                <>
                  {it.computed.series.summary ? (
                    <p className="text-sm">
                      {it.computed.series.summary.op}{" "}
                      <strong>
                        {formatValue(it.computed.series.summary.value)}
                      </strong>
                    </p>
                  ) : null}
                  <MetricChart
                    points={it.computed.series.points}
                    referenceLines={it.computed.series.reference_lines}
                    chartHint={it.computed.series.chart_hint ?? "column"}
                  />
                </>
              ) : (
                <p className="text-xl">
                  <strong>{formatValue(it.computed.value)}</strong>
                </p>
              )}
            </section>
          ))}
          <footer className="text-xs opacity-60 space-y-1 border-t border-[var(--line,#DED9D1)] pt-3">
            <p className="mb-0">{assembled.disclosures.advisory}</p>
            <p className="mb-0">{assembled.disclosures.accuracy}</p>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
