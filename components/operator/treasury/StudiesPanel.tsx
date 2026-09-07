"use client";

import { useCallback, useEffect, useState } from "react";
import { isStudyPlaceable } from "@/lib/treasury/study-assemble";
import {
  StudyAuthorCanvas,
  buildStudySavePayload,
  type StudyCanvasState,
} from "@/components/operator/treasury/StudyAuthorCanvas";
import { newCompositeId } from "@/lib/treasury/study-page-composite";

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

function emptyCanvas(): StudyCanvasState {
  return {
    kpis: [
      {
        id: newCompositeId("kpi"),
        label: "",
        value: "",
        unit: "",
        layout: { w: 3, h: 1 },
      },
    ],
    exhibits: [],
    notes: [],
  };
}

/** Spec B16/B17 M2 — Studies panel (list + confirm + page canvas + place). */
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [typeLabel, setTypeLabel] = useState("Custom");
  const [openingBalance, setOpeningBalance] = useState("");
  const [canvas, setCanvas] = useState<StudyCanvasState>(emptyCanvas);

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
      onError("Open a draft issue to place a study.");
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

  async function saveManual() {
    if (!name.trim()) {
      onError("Study name required");
      return;
    }
    const { results, composite } = buildStudySavePayload({
      name,
      openingBalance,
      canvas,
    });
    const kpiCount = (results.kpis as unknown[])?.length ?? 0;
    const exhibitCount = composite.exhibits.length;
    if (!kpiCount && !exhibitCount) {
      onError("Add at least one KPI or exhibit");
      return;
    }
    setLocalBusy("manual");
    try {
      const res = await fetch(`${base}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type: "external_model",
          type_label: typeLabel.trim() || "Custom",
          results,
          composite,
        }),
      });
      const j = (await res.json()) as { error?: string; issues?: unknown };
      if (!res.ok) {
        throw new Error(j.error ?? "Save study failed");
      }
      setEditorOpen(false);
      setName("");
      setTypeLabel("Custom");
      setOpeningBalance("");
      setCanvas(emptyCanvas());
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save study failed");
    } finally {
      setLocalBusy(null);
    }
  }

  const locked = busy || localBusy != null;

  return (
    <div className="studies-panel" data-testid="studies-panel">
      <div className="rcx-kick">Studies</div>
      <p className="rcx-muted" style={{ fontSize: 11, marginBottom: 8 }}>
        Build a study as a page — arrange KPIs, exhibits, and notes. Confirm
        pending before placing.
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
        <button
          type="button"
          className="rcx-tool"
          disabled={locked}
          onClick={() => {
            setEditorOpen((v) => !v);
            if (!editorOpen) setCanvas(emptyCanvas());
          }}
        >
          {editorOpen ? "Close editor" : "New study"}
        </button>
      </div>

      {editorOpen ? (
        <div
          style={{
            border: "1px solid var(--su-line, #DED9D1)",
            borderRadius: 8,
            padding: 10,
            marginBottom: 12,
            background: "#fff",
          }}
        >
          <StudyAuthorCanvas
            clientUserId={clientUserId}
            name={name}
            typeLabel={typeLabel}
            openingBalance={openingBalance}
            onNameChange={setName}
            onTypeLabelChange={setTypeLabel}
            onOpeningBalanceChange={setOpeningBalance}
            value={canvas}
            onChange={setCanvas}
            disabled={locked}
          />
          <button
            type="button"
            className="rcx-btn sm"
            style={{ marginTop: 8, width: "100%" }}
            disabled={locked}
            onClick={() => void saveManual()}
          >
            Save study
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="rcx-muted" style={{ fontSize: 12 }}>
          Loading studies…
        </p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {studies.map((s) => {
          const placeable = isStudyPlaceable({
            type: s.type,
            status: s.status,
          });
          const pending =
            s.type === "external_model" && s.status === "pending";
          return (
            <li
              key={s.id}
              style={{
                borderTop: "1px solid var(--su-line, #DED9D1)",
                padding: "8px 0",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
              <div className="rcx-muted" style={{ fontSize: 11 }}>
                {s.type}
                {s.status ? ` · ${s.status}` : ""}
                {s.source ? ` · ${s.source}` : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
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
                    Add to issue
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
