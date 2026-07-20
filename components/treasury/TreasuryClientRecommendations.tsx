"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DECLINE_REASONS,
  type DeclineReason,
} from "@/lib/treasury/recommendation-status";
import {
  ClientTracker,
  clientStatusChip,
  formatClientImpactLine,
  FrozenEvidenceList,
  isAnsweredQuestion,
  projectedCaveatFromEvidence,
} from "@/lib/treasury/recommendation-ui";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";

type Props = {
  onUnreadChange?: (count: number) => void;
};

function ClientRecCard({
  rec,
  onAccept,
  onDecline,
  onAnswer,
}: {
  rec: TreasuryRecommendationRow;
  onAccept: () => void;
  onDecline: () => void;
  onAnswer: () => void;
}) {
  const isQuestion = rec.kind === "question";
  const pending = rec.status === "sent";
  const chip = clientStatusChip(rec);
  const projected = !isQuestion ? projectedCaveatFromEvidence(rec.evidence ?? []) : null;
  const impact = !isQuestion ? formatClientImpactLine(rec) : null;
  const showTracker =
    !isQuestion &&
    (rec.status === "sent" ||
      rec.status === "accepted" ||
      rec.status === "in_progress" ||
      rec.status === "done");

  return (
    <article className="rec-card">
      <div className="rc-top">
        <span className={chip.className}>{chip.label}</span>
      </div>
      <p className="rc-why">{rec.title}</p>
      {!isQuestion && rec.why && rec.why !== rec.title ? (
        <p className="impact">Why we suggest this: {rec.why}</p>
      ) : null}
      {projected ? (
        <div className="caveat">
          <span>{projected.caveat}</span>
        </div>
      ) : null}
      <FrozenEvidenceList
        evidence={rec.evidence ?? []}
        variant="client"
        isQuestion={isQuestion}
      />
      {impact ? (
        <p className="impact">
          Estimated impact: {impact}{" "}
          <span className="basis">(estimated by your Summit team)</span>
        </p>
      ) : null}
      {showTracker ? <ClientTracker status={rec.status} /> : null}
      {rec.status === "declined" ? (
        <p className="impact">
          You declined this
          {rec.decline_reason ? `: ${rec.decline_reason.toLowerCase()}` : ""}.
        </p>
      ) : null}
      {isQuestion && isAnsweredQuestion(rec) && rec.client_response ? (
        <div className="rc-answer">
          <b>Your answer:</b> {rec.client_response}
        </div>
      ) : null}
      {pending && !isQuestion ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" style={{ padding: "9px 16px" }} onClick={onAccept}>
            Accept
          </button>
          <button type="button" className="btn decline" style={{ padding: "9px 16px" }} onClick={onDecline}>
            Decline
          </button>
        </div>
      ) : null}
      {pending && isQuestion ? (
        <button type="button" className="btn" style={{ padding: "9px 16px", marginTop: 8 }} onClick={onAnswer}>
          Answer
        </button>
      ) : null}
    </article>
  );
}

export function TreasuryClientRecommendations({ onUnreadChange }: Props) {
  const [recommendations, setRecommendations] = useState<TreasuryRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [declineReason, setDeclineReason] = useState<DeclineReason>(DECLINE_REASONS[0]!);
  const [declineNote, setDeclineNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/treasury/recommendations?mark_seen=1");
    if (res.ok) {
      const data = (await res.json()) as {
        recommendations: TreasuryRecommendationRow[];
        unreadCount: number;
      };
      setRecommendations(data.recommendations);
      onUnreadChange?.(data.unreadCount);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load recommendations");
    }
    setLoading(false);
  }, [onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => recommendations.filter((r) => r.status !== "draft"),
    [recommendations]
  );

  const needsAnswer = visible.filter(
    (r) => r.kind === "question" && r.status === "sent"
  );
  const recItems = visible.filter((r) => r.kind !== "question");
  const answeredQuestions = visible.filter((r) => isAnsweredQuestion(r));

  const acceptRec = visible.find((r) => r.id === acceptId);
  const declineRec = visible.find((r) => r.id === declineId);
  const answerRec = visible.find((r) => r.id === answerId);

  async function patchAction(
    recId: string,
    action: string,
    extra?: Record<string, string>
  ) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/treasury/recommendations/${recId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Action failed");
      setBusy(false);
      return false;
    }
    setAcceptId(null);
    setDeclineId(null);
    setAnswerId(null);
    setAnswerText("");
    setDeclineNote("");
    setBusy(false);
    void load();
    return true;
  }

  return (
    <div>
      <h1 className="rh1">Recommendations</h1>
      <p className="rh-src">
        Recommendations from your Summit team, and questions that need your answer.
      </p>

      {error ? (
        <p className="panel-note mb-4" style={{ color: "var(--su-neg)" }} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="meta">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="meta">
          Nothing here yet. When your Summit team sends a recommendation or a question, it
          will appear here.
        </p>
      ) : (
        <>
          {needsAnswer.length > 0 ? (
            <div className="sent-section">
              <h2>Needs your answer</h2>
              {needsAnswer.map((rec) => (
                <ClientRecCard
                  key={rec.id}
                  rec={rec}
                  onAccept={() => setAcceptId(rec.id)}
                  onDecline={() => {
                    setDeclineReason(DECLINE_REASONS[0]!);
                    setDeclineId(rec.id);
                  }}
                  onAnswer={() => {
                    setAnswerText("");
                    setAnswerId(rec.id);
                  }}
                />
              ))}
            </div>
          ) : null}

          {recItems.length > 0 ? (
            <div className="sent-section">
              <h2>Recommendations</h2>
              {recItems.map((rec) => (
                <ClientRecCard
                  key={rec.id}
                  rec={rec}
                  onAccept={() => setAcceptId(rec.id)}
                  onDecline={() => {
                    setDeclineReason(DECLINE_REASONS[0]!);
                    setDeclineId(rec.id);
                  }}
                  onAnswer={() => {
                    setAnswerText("");
                    setAnswerId(rec.id);
                  }}
                />
              ))}
            </div>
          ) : null}

          {answeredQuestions.length > 0 ? (
            <div className="sent-section">
              <h2>Your answered questions</h2>
              {answeredQuestions.map((rec) => (
                <ClientRecCard
                  key={rec.id}
                  rec={rec}
                  onAccept={() => setAcceptId(rec.id)}
                  onDecline={() => {
                    setDeclineReason(DECLINE_REASONS[0]!);
                    setDeclineId(rec.id);
                  }}
                  onAnswer={() => {
                    setAnswerText("");
                    setAnswerId(rec.id);
                  }}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      {acceptRec ? (
        <div className="tx-drill-overlay" role="presentation">
          <div
            className="tx-drill-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rec-accept-title"
          >
            <div className="tx-drill-head">
              <div>
                <p className="eyebrow">Accept recommendation</p>
                <h3 id="rec-accept-title" className="sec-title" style={{ margin: 0 }}>
                  {acceptRec.title}
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => setAcceptId(null)}
              >
                Close
              </button>
            </div>
            <p className="treasury-muted mb-4">
              You are accepting this recommendation. That commits it, and your Summit team will
              begin the work. You will see it move to In progress, then Done.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void patchAction(acceptRec.id, "accept")}
              >
                Accept and commit
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setAcceptId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {declineRec ? (
        <div className="tx-drill-overlay" role="presentation">
          <div
            className="tx-drill-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rec-decline-title"
          >
            <div className="tx-drill-head">
              <div>
                <p className="eyebrow">Decline recommendation</p>
                <h3 id="rec-decline-title" className="sec-title" style={{ margin: 0 }}>
                  {declineRec.title}
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => setDeclineId(null)}
              >
                Close
              </button>
            </div>
            <label className="rc-f block mb-3">
              <span>Reason</span>
              <select
                className="rec-select"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value as DeclineReason)}
              >
                {DECLINE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="rc-f block mb-4">
              <span>Note (optional)</span>
              <textarea
                className="rec-input"
                rows={2}
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
                placeholder="Add any context for your Summit team"
              />
            </label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void patchAction(declineRec.id, "decline", {
                    decline_reason: declineReason,
                    decline_note: declineNote,
                  })
                }
              >
                Decline
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setDeclineId(null)}
              >
                Cancel
              </button>
            </div>
            <p className="treasury-meta-fine">
              Declined recommendations are final. Your Summit team can propose a fresh one instead.
            </p>
          </div>
        </div>
      ) : null}

      {answerRec ? (
        <div className="tx-drill-overlay" role="presentation">
          <div
            className="tx-drill-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rec-answer-title"
          >
            <div className="tx-drill-head">
              <div>
                <p className="eyebrow">Answer question</p>
                <h3 id="rec-answer-title" className="sec-title" style={{ margin: 0 }}>
                  {answerRec.title}
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => setAnswerId(null)}
              >
                Close
              </button>
            </div>
            <p className="treasury-muted mb-3">{answerRec.why}</p>
            <FrozenEvidenceList
              evidence={answerRec.evidence ?? []}
              variant="client"
              isQuestion
            />
            <label className="rc-f block mb-4 mt-4">
              <span>Your answer</span>
              <textarea
                className="rec-input"
                rows={4}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder="Write your answer for your Summit team"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy || !answerText.trim()}
                onClick={() =>
                  void patchAction(answerRec.id, "answer", {
                    client_response: answerText.trim(),
                  })
                }
              >
                Send answer
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setAnswerId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
