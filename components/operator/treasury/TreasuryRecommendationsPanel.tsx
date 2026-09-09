"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { DraftComposer } from "@/components/operator/treasury/DraftComposer";
import { PickButton } from "@/components/operator/treasury/PickButton";
import { ClientRecCard } from "@/components/treasury/TreasuryClientRecommendations";
import { formatTreasuryAsOf } from "@/lib/treasury/format";
import type { DraftKind, Pickable } from "@/lib/treasury/pickable";
import { isAnsweredUnread } from "@/lib/treasury/recommendation-ui";
import type {
  ResolvedEvidenceItem,
  TreasuryInstitutionView,
  TreasuryRecommendationRollup,
  TreasuryRecommendationRow,
} from "@/lib/treasury/types";

type Props = {
  clientUserId: string;
  clientName?: string;
  institutions: TreasuryInstitutionView[];
  operatorName?: string | null;
  onUnreadChange?: (count: number) => void;
  /** Stage 8b — shared useOptimisticPick.pick */
  onPick?: (draftKind: DraftKind, pickable: Pickable) => void | Promise<void>;
  /** Bump drafts rail after send/discard (not for picks). */
  onBasketChanged?: () => void;
  /** Deep-link `?draft=<id>` — open this draft in the composer. */
  initialDraftId?: string | null;
  onDraftDeepLinkConsumed?: () => void;
};

type DeskTab = "draft" | "sent";

type OpenDraft = {
  draft: TreasuryRecommendationRow;
  items: ResolvedEvidenceItem[];
  missingCount: number;
};

function isEmptyDraft(rec: TreasuryRecommendationRow): boolean {
  return !rec.title?.trim() && (rec.evidence?.length ?? 0) === 0;
}

function operatorDeskUnread(recs: TreasuryRecommendationRow[]): number {
  return recs.filter((r) => {
    if (
      (r.status === "accepted" || r.status === "declined") &&
      r.operator_seen_at == null
    ) {
      return true;
    }
    return isAnsweredUnread(r);
  }).length;
}

export function TreasuryRecommendationsPanel({
  clientUserId,
  clientName = "Client",
  operatorName,
  onUnreadChange,
  onPick,
  onBasketChanged,
  initialDraftId,
  onDraftDeepLinkConsumed,
}: Props) {
  const [recommendations, setRecommendations] = useState<TreasuryRecommendationRow[]>(
    []
  );
  const [rollup, setRollup] = useState<TreasuryRecommendationRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desk, setDesk] = useState<DeskTab>("draft");
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenDraft | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => setOperatorId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        recommendations: TreasuryRecommendationRow[];
        rollup: TreasuryRecommendationRollup;
      };
      setRecommendations(data.recommendations);
      setRollup(data.rollup);
      onUnreadChange?.(operatorDeskUnread(data.recommendations));
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to load recommendations");
    }
    setLoading(false);
  }, [clientUserId, onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const drafts = useMemo(() => {
    return recommendations
      .filter((r) => r.status === "draft")
      .filter((r) => !operatorId || r.created_by === operatorId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [recommendations, operatorId]);

  const sent = useMemo(() => {
    return recommendations
      .filter((r) => r.status !== "draft")
      .sort((a, b) => {
        const aUnread = isAnsweredUnread(a) ? 1 : 0;
        const bUnread = isAnsweredUnread(b) ? 1 : 0;
        if (aUnread !== bUnread) return bUnread - aUnread;
        const at = a.sent_at ?? a.sealed_at ?? a.created_at;
        const bt = b.sent_at ?? b.sealed_at ?? b.created_at;
        return bt.localeCompare(at);
      });
  }, [recommendations]);

  const openDraftById = useCallback(
    async (recId: string) => {
      setOpeningId(recId);
      setError(null);
      const res = await fetch(
        `/api/operator/treasury/clients/${clientUserId}/recommendations/${recId}`
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        recommendation?: TreasuryRecommendationRow;
        items?: ResolvedEvidenceItem[];
        missingCount?: number;
      };
      setOpeningId(null);
      if (!res.ok || !data.recommendation) {
        setError(data.error ?? "Failed to open draft");
        return;
      }
      if (data.recommendation.status !== "draft") {
        setDesk("sent");
        setError("That item is no longer a draft.");
        return;
      }
      setDesk("draft");
      setOpen({
        draft: data.recommendation,
        items: data.items ?? [],
        missingCount: data.missingCount ?? 0,
      });
    },
    [clientUserId]
  );

  useEffect(() => {
    if (!initialDraftId) return;
    void openDraftById(initialDraftId).then(() => onDraftDeepLinkConsumed?.());
  }, [initialDraftId, openDraftById, onDraftDeepLinkConsumed]);

  async function refreshOpenEvidence() {
    if (!open) return;
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${open.draft.id}`
    );
    if (!res.ok) return;
    const data = (await res.json()) as OpenDraft & {
      recommendation: TreasuryRecommendationRow;
    };
    setOpen({
      draft: data.recommendation,
      items: data.items,
      missingCount: data.missingCount,
    });
    onBasketChanged?.();
  }

  async function discardDraft(recId: string) {
    if (!confirm("Delete this empty draft?")) return;
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${recId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard_draft" }),
      }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Delete failed");
      return;
    }
    if (open?.draft.id === recId) setOpen(null);
    onBasketChanged?.();
    void load();
  }

  async function patchAction(recId: string, action: string) {
    const res = await fetch(
      `/api/operator/treasury/clients/${clientUserId}/recommendations/${recId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Action failed");
      return;
    }
    void load();
  }

  // B24 Part 2 — sent ledger bands by who holds it.
  const withClient = sent.filter((r) => r.status === "sent");
  const decided = sent.filter((r) => r.status !== "sent");
  const noop = () => {};

  function renderDraftCard(rec: TreasuryRecommendationRow) {
    const empty = isEmptyDraft(rec);
    const kindLabel = rec.kind === "question" ? "Question" : "Recommendation";
    return (
      <article
        key={rec.id}
        className={`rec-card rec-card-draft${empty ? " empty" : ""}`}
      >
        <div className="rec-top">
          <span className="rec-kind">{kindLabel}</span>
          <span className="rec-private-chip">🔒 private</span>
          {!empty ? (
            <span className="rec-ev-n">
              {rec.evidence.length} item{rec.evidence.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <h3 className="rec-title">
          {empty ? "Empty draft" : rec.title?.trim() || "Untitled draft"}
        </h3>
        {!empty && rec.why?.trim() ? (
          <p className="rec-why">
            <span className="rw-l">{rec.kind === "question" ? "Question" : "Why"}</span>
            {rec.why}
          </p>
        ) : null}
        <div className="rec-acts">
          <button
            type="button"
            className="btn sm"
            disabled={openingId === rec.id}
            onClick={() => void openDraftById(rec.id)}
          >
            {openingId === rec.id ? "Opening…" : "Open"}
          </button>
          {empty ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => void discardDraft(rec.id)}
            >
              Delete
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  function renderSentCard(rec: TreasuryRecommendationRow) {
    return (
      <article
        key={rec.id}
        className={`rec-op-sent${isAnsweredUnread(rec) ? " unread" : ""}`}
        onClick={() => {
          if (isAnsweredUnread(rec)) void patchAction(rec.id, "mark_seen");
        }}
      >
        <div className="rec-op-strap">
          <span className="rec-op-as">As {clientName} sees it</span>
          {rec.sealed_at && onPick ? (
            <PickButton
              variant="row"
              pickable={{
                kind: "recommendation",
                ref: rec.id,
                label: rec.title || "Recommendation",
                sublabel: `sealed · ${formatTreasuryAsOf(rec.sealed_at)}`,
              }}
              onPick={onPick}
            />
          ) : null}
        </div>
        <ClientRecCard
          rec={rec}
          readOnly
          onAccept={noop}
          onDecline={noop}
          onAnswer={noop}
        />
        <div className="rec-acts" onClick={(e) => e.stopPropagation()}>
          {rec.status === "accepted" ? (
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => void patchAction(rec.id, "mark_in_progress")}
            >
              Mark in progress
            </button>
          ) : null}
          {rec.status === "in_progress" ? (
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => void patchAction(rec.id, "mark_done")}
            >
              Mark done
            </button>
          ) : null}
          {(rec.status === "accepted" || rec.status === "declined") &&
          rec.operator_seen_at == null ? (
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => void patchAction(rec.id, "mark_seen")}
            >
              Mark seen
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div>
      {rollup ? (
        <div className="rec-rollup">
          <span className="rr-i">
            <b>{rollup.awaiting}</b> awaiting response
          </span>
          {(rollup.answeredReview ?? 0) > 0 ? (
            <span className="rr-i rr-answered">
              <span className="rr-adot" aria-hidden />
              <b>{rollup.answeredReview}</b> answered — review
            </span>
          ) : null}
          <span className="rr-i">
            <b>{rollup.accepted}</b> accepted
          </span>
          <span className="rr-i">
            <b>{rollup.in_progress}</b> in progress
          </span>
          <span className="rr-i">
            <b>{rollup.done}</b> done
          </span>
          <span className="rr-i muted">
            <b>{rollup.declined}</b> declined
          </span>
        </div>
      ) : null}

      <div className="rec-desk-tabs" role="tablist" aria-label="Recommendations desk">
        <button
          type="button"
          role="tab"
          aria-selected={desk === "draft"}
          className={`rec-desk-tab${desk === "draft" ? " on" : ""}`}
          onClick={() => setDesk("draft")}
        >
          Draft
          {drafts.length > 0 ? <span className="rec-desk-n">{drafts.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={desk === "sent"}
          className={`rec-desk-tab${desk === "sent" ? " on" : ""}`}
          onClick={() => setDesk("sent")}
        >
          Sent
          {sent.length > 0 ? <span className="rec-desk-n">{sent.length}</span> : null}
        </button>
      </div>

      {error ? (
        <p className="panel-note text-cinnabar mb-4" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-codex-muted">Loading…</p>
      ) : desk === "draft" ? (
        <>
          <p className="rec-band-note">
            On your desk · only you. Drafts stay private until you send.
          </p>
          {drafts.length === 0 ? (
            <p className="rec-empty">
              No drafts yet. Pick evidence anywhere — a study, a rule, a
              transaction — then open a draft here.
            </p>
          ) : (
            <div className="rec-grid">{drafts.map(renderDraftCard)}</div>
          )}
        </>
      ) : sent.length === 0 ? (
        <p className="rec-empty">Nothing sent yet.</p>
      ) : (
        <>
          {withClient.length > 0 ? (
            <section className="rec-band">
              <h4 className="rec-band-h">With the client</h4>
              <div className="rec-grid">{withClient.map(renderSentCard)}</div>
            </section>
          ) : null}
          {decided.length > 0 ? (
            <section className="rec-band">
              <h4 className="rec-band-h">Decided &amp; answered</h4>
              <div className="rec-grid">{decided.map(renderSentCard)}</div>
            </section>
          ) : null}
        </>
      )}

      {open ? (
        <DraftComposer
          clientUserId={clientUserId}
          draftKind={open.draft.kind}
          draft={open.draft}
          items={open.items}
          missingCount={open.missingCount}
          onClose={() => setOpen(null)}
          onSent={() => {
            setOpen(null);
            setDesk("sent");
            onBasketChanged?.();
            void load();
          }}
          onEvidenceChanged={() => void refreshOpenEvidence()}
        />
      ) : null}
    </div>
  );
}
