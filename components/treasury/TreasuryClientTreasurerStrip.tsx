"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clientStatusChip,
  ClientTracker,
  isAnsweredQuestion,
} from "@/lib/treasury/recommendation-ui";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";

type Props = {
  onReviewPending?: () => void;
  onRecommendationsChange?: (recs: TreasuryRecommendationRow[], unreadCount: number) => void;
};

export function TreasuryClientTreasurerStrip({
  onReviewPending,
  onRecommendationsChange,
}: Props) {
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
  const inMotion = visible.filter(
    (r) => r.status === "accepted" || r.status === "in_progress"
  ).length;
  const answered = visible.filter((r) => isAnsweredQuestion(r)).length;
  const done = visible.filter(
    (r) => r.kind !== "question" && r.status === "done"
  ).length;

  const previewCards = useMemo(() => {
    const pending = visible.filter((r) => r.status === "sent").slice(0, 2);
    const inFlight = visible.filter(
      (r) =>
        r.kind !== "question" &&
        (r.status === "accepted" || r.status === "in_progress")
    ).slice(0, 1);
    return [...pending, ...inFlight];
  }, [visible]);

  if (loading) {
    return (
      <p className="meta" style={{ marginBottom: 20 }}>
        Loading recommendations…
      </p>
    );
  }

  if (visible.length === 0) {
    return null;
  }

  return (
    <>
      <div className="rollup-line">
        <b>Your Summit team is working on:</b> {awaiting} awaiting your reply,{" "}
        {inMotion} in motion, {answered} answered, {done} done.
      </div>

      {previewCards.map((rec) => {
        const chip = clientStatusChip(rec);
        const isPending = rec.status === "sent";
        const showTracker =
          !isPending &&
          rec.kind !== "question" &&
          (rec.status === "accepted" ||
            rec.status === "in_progress" ||
            rec.status === "done");

        return (
          <article key={rec.id} className="rec-card">
            <div className="rc-top">
              <span className={chip.className}>{chip.label}</span>
            </div>
            <p className="rc-why">{rec.title}</p>
            {isPending ? (
              <button
                type="button"
                className="tile-act"
                onClick={onReviewPending}
              >
                {rec.kind === "question"
                  ? "Answer in Recommendations"
                  : "Review in Recommendations"}
              </button>
            ) : null}
            {showTracker ? <ClientTracker status={rec.status} /> : null}
          </article>
        );
      })}
    </>
  );
}
