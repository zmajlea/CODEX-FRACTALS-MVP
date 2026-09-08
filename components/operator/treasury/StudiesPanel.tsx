"use client";

import { useCallback, useEffect, useState } from "react";
import { isStudyPlaceable } from "@/lib/treasury/study-assemble";
import { getModelKind } from "@/lib/treasury/model-kinds";

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
  /** Open the Model Studio (mounted by the parent composer). */
  onOpenStudio: () => void;
  /** Refresh signal — bump to reload the models list after a Studio save. */
  refreshKey?: number;
  /** study_ids already placed on the open draft, to mark "placed". */
  placedStudyIds?: string[];
};

const GRADE_LABEL: Record<string, string> = {
  solid: "Solid",
  indicative: "Indicative",
  thin: "Thin",
  refused: "Refused",
};

function gradeOf(derived: unknown): string | null {
  if (derived && typeof derived === "object") {
    const g = (derived as { confidence?: { grade?: string } }).confidence?.grade;
    return g ?? null;
  }
  return null;
}

/**
 * Models group in the Studies shelf (Phase 2, Part B).
 * Lists this client's Models with kind + confidence chips; Place / Confirm / Discard;
 * "+ New model" opens the Model Studio. Cash model via "Ensure primary cash model".
 */
export function StudiesPanel({
  clientUserId,
  reviewId,
  reviewStatus,
  busy,
  onPlaced,
  onError,
  onOpenStudio,
  refreshKey,
  placedStudyIds,
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
  }, [load, refreshKey]);

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
  const placedSet = new Set(placedStudyIds ?? []);

  return (
    <div className="studies-panel" data-testid="studies-panel">
      <div className="rcx-kick" style={{ display: "flex", alignItems: "center" }}>
        Models
        <span className="rcx-muted" style={{ fontSize: 10, marginLeft: 6 }}>
          · {studies.length}
        </span>
        <button
          type="button"
          className="rcx-linkbtn"
          style={{ marginLeft: "auto" }}
          disabled={locked}
          onClick={onOpenStudio}
        >
          + New model
        </button>
      </div>
      <p className="rcx-muted" style={{ fontSize: 11, marginBottom: 8 }}>
        Engine-computed from the ledger and your assumptions. Assistant submissions land
        pending and need your Confirm.
      </p>

      <button
        type="button"
        className="rcx-sitem new"
        disabled={locked}
        onClick={onOpenStudio}
      >
        <span className="ico">+</span>
        <span className="sn">New model</span>
        <span className="sk">
          Forecast · Seasonality — pick a kind, set the assumptions, watch it compute.
        </span>
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
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
            derived_snapshot: s.derived_snapshot,
          });
          const pending = s.type === "external_model" && s.status === "pending";
          const placed = placedSet.has(s.id);
          const grade = gradeOf(s.derived_snapshot);
          const kindLabel = getModelKind(s.type)?.label ?? s.type;
          return (
            <li
              key={s.id}
              className={`rcx-sitem model${pending ? " pending" : ""}`}
            >
              <div className="sn">
                {s.name}
                <span className="chip">{kindLabel}</span>
                {grade ? (
                  <span className="conf" data-grade={grade}>
                    {GRADE_LABEL[grade] ?? grade}
                  </span>
                ) : null}
              </div>
              <div className="sk">
                {pending ? "pending" : s.status ?? "ready"}
                {s.source ? ` · ${s.source}` : ""}
                {s.is_primary ? " · primary" : ""}
                {placed ? " · placed" : ""}
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
                    disabled={locked || reviewStatus !== "draft" || !reviewId || placed}
                    onClick={() => void placeStudy(s.id)}
                  >
                    {placed ? "On the Study" : "Add Model"}
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
