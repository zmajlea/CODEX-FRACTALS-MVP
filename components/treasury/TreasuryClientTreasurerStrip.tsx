"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  RECOMMENDATION_CATEGORY_LABELS,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import { ExecLadder, formatImpactLine } from "@/lib/treasury/recommendation-ui";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";

type Props = {
  onReviewPending?: () => void;
  onRecommendationsChange?: (recs: TreasuryRecommendationRow[], unreadCount: number) => void;
};

function formatImpactShort(rec: TreasuryRecommendationRow): string {
  if (rec.impact_amount == null) return "—";
  const cur = rec.impact_unit ?? "USD";
  const money = formatTreasuryMoney(rec.impact_amount, cur);
  if (rec.impact_basis === "per_year") return `${money}/yr`;
  if (rec.impact_basis === "per_month") return `${money}/mo`;
  if (rec.impact_basis === "one_time") return `${money} one time`;
  return money;
}

export function TreasuryClientTreasurerStrip({ onReviewPending, onRecommendationsChange }: Props) {
  const [recommendations, setRecommendations] = useState<TreasuryRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/treasury/recommendations");
    if (res.ok) {
      const data = (await res.json()) as {
        recommendations: TreasuryRecommendationRow[];
        unreadCount: number;
      };
      setRecommendations(data.recommendations);
      onRecommendationsChange?.(data.recommendations, data.unreadCount);
    }
    setLoading(false);
  }, [onRecommendationsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => recommendations.filter((r) => r.status !== "draft"),
    [recommendations]
  );

  const awaiting = visible.filter((r) => r.status === "sent").length;
  const inMotion = visible.filter((r) => r.status === "accepted" || r.status === "in_progress").length;
  const done = visible.filter((r) => r.status === "done").length;

  const pendingRow = visible.find((r) => r.status === "sent");
  const inFlight = visible.filter(
    (r) => r.status === "accepted" || r.status === "in_progress"
  ).slice(0, 2);

  if (loading) {
    return (
      <section className="ct-treasurer-panel treasury-section">
        <p className="treasury-muted">Loading recommendations…</p>
      </section>
    );
  }

  if (visible.length === 0) {
    return null;
  }

  return (
    <section className="ct-treasurer-panel treasury-section" aria-label="Your treasurer is working on">
      <h2 className="sec-title">Your treasurer is working on</h2>
      <div className="rec-rollup">
        <span className="rr-i">
          <b>{awaiting}</b> awaiting your reply
        </span>
        <span className="rr-i">
          <b>{inMotion}</b> in motion
        </span>
        <span className="rr-i">
          <b>{done}</b> done
        </span>
      </div>

      {pendingRow ? (
        <div className="ct-treasurer-row awaiting">
          <div className="ct-treasurer-row-main">
            <div className="ct-treasurer-row-title">{pendingRow.title}</div>
            <span className="rec-cat">{RECOMMENDATION_CATEGORY_LABELS[pendingRow.category]}</span>
          </div>
          <div className="ct-treasurer-row-impact">{formatImpactShort(pendingRow)}</div>
          <button type="button" className="btn text-xs" onClick={onReviewPending}>
            Review →
          </button>
        </div>
      ) : null}

      {inFlight.map((rec) => (
        <div key={rec.id} className="ct-treasurer-row">
          <div className="ct-treasurer-row-main">
            <div className="ct-treasurer-row-title">{rec.title}</div>
            <span className="rec-cat">{RECOMMENDATION_CATEGORY_LABELS[rec.category]}</span>
            <ExecLadder status={rec.status as RecommendationStatus} />
          </div>
          <div className="ct-treasurer-row-impact">{formatImpactLine(rec)}</div>
        </div>
      ))}
    </section>
  );
}
