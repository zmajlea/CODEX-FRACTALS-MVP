"use client";

import { useCallback, useEffect, useState } from "react";
import type { DraftKind } from "@/lib/treasury/pickable";

type DraftRow = {
  id: string;
  title: string;
  why: string;
  kind: string;
  status: string;
  category?: string;
};

type DraftBundle = {
  draft: DraftRow;
  items: unknown[];
  missingCount: number;
} | null;

type Props = {
  clientUserId: string;
  draftKindTarget: DraftKind;
  onDraftKindChange: (k: DraftKind) => void;
};

/** Spec B15 — composer Drafts area (reuse draft GET + send/discard). */
export function ReviewDraftsPanel({
  clientUserId,
  draftKindTarget,
  onDraftKindChange,
}: Props) {
  const [rec, setRec] = useState<DraftBundle>(null);
  const [q, setQ] = useState<DraftBundle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DraftKind | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");

  const base = `/api/operator/treasury/clients/${clientUserId}`;

  const refresh = useCallback(async () => {
    const res = await fetch(`${base}/recommendations/draft`);
    if (!res.ok) return;
    const json = (await res.json()) as {
      recommendation: DraftBundle;
      question: DraftBundle;
    };
    setRec(json.recommendation);
    setQ(json.question);
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function ensureDraft(kind: DraftKind) {
    setBusy(true);
    setError(null);
    try {
      // Creating via evidence route with empty pick is awkward; use list POST for rec,
      // and draft/evidence findOrCreate happens on first pick. For questions/recs with
      // no evidence yet, POST a draft via recommendations with send=false.
      const res = await fetch(`${base}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || (kind === "question" ? "Question" : "Recommendation"),
          why: why.trim(),
          category: "liquidity",
          kind,
          send: false,
        }),
      });
      const json = (await res.json()) as { error?: string; recommendation?: DraftRow };
      if (!res.ok) throw new Error(json.error ?? "Create draft failed");
      setEditing(null);
      setTitle("");
      setWhy("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendDraft(id: string) {
    if (!confirm("Send to client?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Send failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft(id: string) {
    if (!confirm("Discard this draft?")) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/recommendations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard_draft" }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Discard failed");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setBusy(false);
    }
  }

  function row(bundle: DraftBundle, kind: DraftKind) {
    if (!bundle?.draft) return null;
    const d = bundle.draft;
    return (
      <div key={d.id} className="rcx-draft-row">
        <div className="dt">
          <strong>{d.title || `(untitled ${kind})`}</strong>
          <span className="dm">
            {kind} · {bundle.items?.length ?? 0} evidence
          </span>
        </div>
        <div className="db">
          <button
            type="button"
            className="rcx-tool primary"
            disabled={busy}
            onClick={() => void sendDraft(d.id)}
          >
            Send
          </button>
          <button
            type="button"
            className="rcx-tool danger"
            disabled={busy}
            onClick={() => void discardDraft(d.id)}
          >
            Discard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rcx-drafts">
      <div className="rcx-kick" style={{ marginBottom: 6 }}>
        Drafts · cite target:{" "}
        <select
          value={draftKindTarget}
          onChange={(e) => onDraftKindChange(e.target.value as DraftKind)}
          style={{ fontSize: 11 }}
        >
          <option value="recommendation">recommendation</option>
          <option value="question">question</option>
        </select>
      </div>
      {error ? <p className="rcx-err" style={{ fontSize: 12 }}>{error}</p> : null}
      {row(rec, "recommendation")}
      {row(q, "question")}
      {!rec && !q ? (
        <p className="rcx-muted" style={{ fontSize: 12 }}>
          No open drafts. Create one, then ＋ Add to draft on an exhibit.
        </p>
      ) : null}
      {editing ? (
        <div className="rcx-draft-form">
          <input
            className="rcx-title"
            style={{ fontSize: 13, marginBottom: 4 }}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            style={{ width: "100%", minHeight: 56, fontSize: 12 }}
            placeholder={editing === "question" ? "Question / answer context" : "Why"}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="rcx-btn sm"
              disabled={busy}
              onClick={() => void ensureDraft(editing)}
            >
              Save draft
            </button>
            <button
              type="button"
              className="rcx-tool"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="rcx-btn ghost sm"
            onClick={() => {
              setEditing("recommendation");
              setTitle("");
              setWhy("");
            }}
          >
            + New recommendation
          </button>
          <button
            type="button"
            className="rcx-btn ghost sm"
            onClick={() => {
              setEditing("question");
              setTitle("");
              setWhy("");
            }}
          >
            + New question
          </button>
        </div>
      )}
    </div>
  );
}
