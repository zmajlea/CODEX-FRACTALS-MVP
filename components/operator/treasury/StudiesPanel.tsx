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

type EditorKpi = { label: string; value: string; unit: string };

/** Spec B16 — Studies panel inside Review (list + confirm + manual editor + place). */
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
  const [kpis, setKpis] = useState<EditorKpi[]>([
    { label: "", value: "", unit: "" },
  ]);
  const [openingBalance, setOpeningBalance] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/studies`);
      if (!res.ok) return;
      const json = (await res.json()) as { studies?: StudyListItem[] };
      setStudies(
        (json.studies ?? []).filter((s) => s.type !== "spend_plan")
      );
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
    const cleaned = kpis
      .map((k) => ({
        label: k.label.trim(),
        value: Number.isFinite(Number(k.value)) ? Number(k.value) : k.value.trim(),
        unit: k.unit.trim() || undefined,
      }))
      .filter((k) => k.label);
    if (!name.trim()) {
      onError("Study name required");
      return;
    }
    if (!cleaned.length) {
      onError("Add at least one KPI");
      return;
    }
    setLocalBusy("manual");
    try {
      const results: Record<string, unknown> = {
        schema_version: "summit.results/v1",
        export_id: `manual-${Date.now()}`,
        as_of: new Date().toISOString().slice(0, 10),
        headline: name.trim(),
        kpis: cleaned,
        scenarios: [],
        narrative: [],
        recommendations: [],
        actuals_check: [],
      };
      if (openingBalance.trim() && Number.isFinite(Number(openingBalance))) {
        results.opening_balance = Number(openingBalance);
      }
      const res = await fetch(`${base}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type: "external_model",
          type_label: typeLabel.trim() || "Custom",
          results,
        }),
      });
      const j = (await res.json()) as { error?: string; issues?: unknown };
      if (!res.ok) {
        throw new Error(j.error ?? "Save study failed");
      }
      setEditorOpen(false);
      setName("");
      setKpis([{ label: "", value: "", unit: "" }]);
      setOpeningBalance("");
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
        Computed cash model or manual/AI studies. Confirm pending before placing.
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
          onClick={() => setEditorOpen((v) => !v)}
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
          <label className="rcx-muted" style={{ display: "block", fontSize: 11 }}>
            Name
            <input
              className="rcx-confirm-input"
              style={{ display: "block", width: "100%", marginTop: 4 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label
            className="rcx-muted"
            style={{ display: "block", fontSize: 11, marginTop: 8 }}
          >
            Type label
            <input
              className="rcx-confirm-input"
              style={{ display: "block", width: "100%", marginTop: 4 }}
              value={typeLabel}
              onChange={(e) => setTypeLabel(e.target.value)}
              placeholder="Working Capital, PE Diligence…"
            />
          </label>
          <label
            className="rcx-muted"
            style={{ display: "block", fontSize: 11, marginTop: 8 }}
          >
            Opening balance (optional)
            <input
              className="rcx-confirm-input"
              style={{ display: "block", width: "100%", marginTop: 4 }}
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </label>
          <div className="rcx-muted" style={{ fontSize: 11, marginTop: 10 }}>
            KPIs
          </div>
          {kpis.map((k, i) => (
            <div key={i} style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <input
                placeholder="Label"
                value={k.label}
                onChange={(e) => {
                  const next = [...kpis];
                  next[i] = { ...k, label: e.target.value };
                  setKpis(next);
                }}
                style={{ flex: 2, fontSize: 12, padding: 6 }}
              />
              <input
                placeholder="Value"
                value={k.value}
                onChange={(e) => {
                  const next = [...kpis];
                  next[i] = { ...k, value: e.target.value };
                  setKpis(next);
                }}
                style={{ flex: 1, fontSize: 12, padding: 6 }}
              />
              <input
                placeholder="Unit"
                value={k.unit}
                onChange={(e) => {
                  const next = [...kpis];
                  next[i] = { ...k, unit: e.target.value };
                  setKpis(next);
                }}
                style={{ width: 56, fontSize: 12, padding: 6 }}
              />
            </div>
          ))}
          <button
            type="button"
            className="rcx-tool"
            style={{ marginTop: 6 }}
            onClick={() =>
              setKpis((prev) => [...prev, { label: "", value: "", unit: "" }])
            }
          >
            + KPI
          </button>
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
                border: "1px solid var(--su-line, #DED9D1)",
                borderRadius: 8,
                padding: 8,
                marginBottom: 8,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
              <div className="rcx-muted" style={{ fontSize: 11 }}>
                {s.type}
                {s.is_primary ? " · primary" : ""}
                {s.status ? ` · ${s.status}` : ""}
                {s.source ? ` · ${s.source}` : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                {pending ? (
                  <>
                    <button
                      type="button"
                      className="rcx-tool primary"
                      disabled={locked}
                      onClick={() => void confirmStudy(s.id)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="rcx-tool danger"
                      disabled={locked}
                      onClick={() => void discardStudy(s.id)}
                    >
                      Discard
                    </button>
                  </>
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
              </div>
            </li>
          );
        })}
      </ul>
      {!loading && studies.length === 0 ? (
        <p className="rcx-muted" style={{ fontSize: 12 }}>
          No studies yet. Ensure the cash model or author one manually.
        </p>
      ) : null}
    </div>
  );
}
