"use client";

import { useCallback, useEffect, useState } from "react";
import { isStudyPlaceable } from "@/lib/treasury/study-assemble";

type StudyListItem = {
  id: string;
  name: string;
  type: string;
  status?: string | null;
  source?: string | null;
  is_primary?: boolean;
  derived_snapshot?: unknown;
  updated_at?: string;
};

type Props = {
  clientUserId: string;
  reviewId: string | null;
  reviewStatus: string;
  busy: boolean;
  onPlaced: () => void;
  onError: (msg: string) => void;
};

/**
 * Spec B19-C2 — Models shelf (was B16 "Studies" panel).
 * Lists placeable Models; overlay StudyAuthorCanvas retired (composer is ReviewTabPanel).
 */
export function StudiesPanel({
  clientUserId,
  reviewId,
  reviewStatus,
  busy,
  onPlaced,
  onError,
}: Props) {
  const base = `/api/operator/treasury/clients/${clientUserId}`;
  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [localBusy, setLocalBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/studies`);
      if (!res.ok) return;
      const json = (await res.json()) as { studies?: StudyListItem[] };
      setStudies((json.studies ?? []).filter((s) => s.type !== "spend_plan"));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ensurePrimary() {
    setLocalBusy("ensure");
    try {
      const res = await fetch(`${base}/studies/ensure-primary-cash-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Ensure primary failed");
      }
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Ensure primary failed");
    } finally {
      setLocalBusy(null);
    }
  }

  async function confirmStudy(id: string) {
    setLocalBusy(id);
    try {
      const res = await fetch(`${base}/studies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Confirm failed");
      }
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setLocalBusy(null);
    }
  }

  async function discardStudy(id: string) {
    setLocalBusy(id);
    try {
      const res = await fetch(`${base}/studies/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Discard failed");
      }
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Discard failed");
    } finally {
      setLocalBusy(null);
    }
  }

  async function placeStudy(id: string) {
    if (!reviewId || reviewStatus !== "draft") {
      onError("Open a draft Study to place a Model.");
      return;
    }
    setLocalBusy(`place-${id}`);
    try {
      const res = await fetch(`${base}/reviews/${reviewId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "study", study_id: id }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Place failed");
      onPlaced();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Place failed");
    } finally {
      setLocalBusy(null);
    }
  }

  const locked = busy || localBusy != null;

  return (
    <div className="studies-panel" data-testid="studies-panel">
      <div className="rcx-kick">Models</div>
      <p className="rcx-muted" style={{ fontSize: 11, marginBottom: 8 }}>
        Cash models and confirmed analyses — place on the Study canvas.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          className="rcx-tool"
          disabled={locked}
          onClick={() => void ensurePrimary()}
        >
          Ensure primary cash model
        </button>
      </div>

      {loading ? (
        <p className="rcx-muted" style={{ fontSize: 12 }}>
          Loading models…
        </p>
      ) : null}

      <ul className="rcx-slist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {studies.map((s) => {
          const placeable = isStudyPlaceable({
            type: s.type,
            status: s.status,
          });
          const pending =
            s.type === "external_model" && s.status === "pending";
          return (
            <li key={s.id} className="rcx-sitem model">
              <div className="sn">
                {s.name}
                <span className="chip">{s.type === "cash_model" ? "cash" : "model"}</span>
              </div>
              <div className="sk">
                {s.status ?? "ready"}
                {s.source ? ` · ${s.source}` : ""}
                {s.is_primary ? " · primary" : ""}
              </div>
              <div className="sb">
                {pending ? (
                  <button
                    type="button"
                    className="rcx-tool primary"
                    disabled={locked}
                    onClick={() => void confirmStudy(s.id)}
                  >
                    Confirm
                  </button>
                ) : null}
                {placeable ? (
                  <button
                    type="button"
                    className="rcx-tool"
                    disabled={locked || reviewStatus !== "draft" || !reviewId}
                    onClick={() => void placeStudy(s.id)}
                  >
                    Add Model
                  </button>
                ) : null}
                {s.type === "external_model" ? (
                  <button
                    type="button"
                    className="rcx-tool danger"
                    disabled={locked}
                    onClick={() => void discardStudy(s.id)}
                  >
                    Discard
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
