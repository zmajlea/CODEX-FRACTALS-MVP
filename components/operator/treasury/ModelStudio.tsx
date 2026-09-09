"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listedModelKinds,
  getModelKind,
  type ModelKindDef,
  type ParamField,
} from "@/lib/treasury/model-kinds";

/**
 * Models Phase 2 (Part B) — Model Studio.
 * Kind → Set up (dynamic form from kind.form[]) → Preview (live POST /studies/preview).
 * Save / Save & place. Never client-visible; operator-only authoring surface.
 */

type PreviewKpi = {
  id?: string;
  label: string;
  value: number | string;
  unit?: string | null;
  basis?: string | null;
};
type PreviewPoint = { month?: string; label?: string; ending?: number; value?: number; projected?: boolean };
type PreviewSnapshot = {
  name: string;
  as_of: string;
  kpis: PreviewKpi[];
  timeline?: { points?: PreviewPoint[]; reference_lines?: { label: string; value: number }[] } | null;
  exhibits?: { points?: PreviewPoint[]; series_kind?: string }[];
};
type PreviewConfidence = { grade: string; reasons: string[]; historyMonthCount?: number; cyclesObserved?: number };
type PreviewResult = { snapshot: PreviewSnapshot; confidence: PreviewConfidence; explain: string };

type Props = {
  clientUserId: string;
  reviewId: string | null;
  reviewStatus: string;
  open: boolean;
  onClose: () => void;
  onSaved: (opts: { placed: boolean }) => void;
  onError: (msg: string) => void;
};

type Step = "kind" | "setup" | "preview";

const GRADE_LABEL: Record<string, string> = {
  solid: "Solid",
  indicative: "Indicative",
  thin: "Thin",
  refused: "Refused",
};

function fmtValue(v: number | string, unit?: string | null): string {
  if (typeof v === "string") return v;
  if (unit === "usd") {
    return v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function defaultParamsFor(kind: ModelKindDef): Record<string, unknown> {
  const parsed = kind.params.safeParse({});
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/** Tiny inline line/column sparkline for the preview exhibit. */
function PreviewSpark({ snap }: { snap: PreviewSnapshot }) {
  const points =
    snap.exhibits?.[0]?.points ?? snap.timeline?.points ?? [];
  const analytics = snap.exhibits?.[0]?.series_kind === "analytics";
  const vals = points.map((p) => (p.ending ?? p.value ?? 0));
  if (vals.length === 0) return null;
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 1);
  const span = hi - lo || 1;
  const W = 300;
  const H = 90;
  const step = vals.length > 1 ? W / (vals.length - 1) : W;
  if (analytics) {
    const bw = W / vals.length - 3;
    return (
      <svg className="wz-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {vals.map((v, i) => {
          const h = ((v - lo) / span) * (H - 8);
          return (
            <rect
              key={i}
              x={i * (W / vals.length) + 1.5}
              y={H - h}
              width={Math.max(2, bw)}
              height={h}
            />
          );
        })}
      </svg>
    );
  }
  const firstProj = points.findIndex((p) => p.projected);
  const hist: string[] = [];
  const proj: string[] = [];
  vals.forEach((v, i) => {
    const x = i * step;
    const y = H - ((v - lo) / span) * (H - 8) - 4;
    const cmd = `${x.toFixed(1)},${y.toFixed(1)}`;
    if (firstProj >= 0 && i >= firstProj) proj.push(cmd);
    else hist.push(cmd);
  });
  if (firstProj >= 0 && hist.length > 0) proj.unshift(hist[hist.length - 1]!);
  return (
    <svg className="wz-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {hist.length > 1 ? <polyline points={hist.join(" ")} /> : null}
      {proj.length > 1 ? <polyline className="proj" points={proj.join(" ")} /> : null}
    </svg>
  );
}

function Field({
  field,
  params,
  historyMonths,
  setParam,
}: {
  field: ParamField;
  params: Record<string, unknown>;
  historyMonths: number;
  setParam: (key: string, value: unknown) => void;
}) {
  const val = params[field.key];

  if (field.kind === "select") {
    const current = typeof val === "object" && val !== null
      ? (val as { kind?: string }).kind ?? ""
      : String(val ?? "");
    // `subject` is stored as an object {kind,id}; other selects are scalars.
    const isSubject = field.key === "subject";
    return (
      <div className="wz-fg">
        <label>{field.label}</label>
        <div className="wz-ctl">
          <select
            value={current}
            onChange={(e) => {
              const v = e.target.value;
              setParam(field.key, isSubject ? { kind: v } : v);
            }}
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value} disabled={!!o.disabledReason}>
                {o.label}
                {o.disabledReason ? ` — ${o.disabledReason}` : ""}
              </option>
            ))}
          </select>
          {isSubject && (current === "bucket" || current === "category") ? (
            <input
              type="text"
              placeholder={`${current} id`}
              value={String((val as { id?: string })?.id ?? "")}
              onChange={(e) =>
                setParam(field.key, { kind: current, id: e.target.value })
              }
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (field.kind === "months" || field.kind === "number") {
    return (
      <div className="wz-fg">
        <label>{field.label}</label>
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={Number(val ?? field.min ?? 0)}
          onChange={(e) => setParam(field.key, Number(e.target.value))}
        />
      </div>
    );
  }

  if (field.kind === "toggle") {
    return (
      <div className="wz-fg toggle">
        <label>{field.label}</label>
        <input
          type="checkbox"
          checked={!!val}
          onChange={(e) => setParam(field.key, e.target.checked)}
        />
      </div>
    );
  }

  if (field.kind === "money") {
    return (
      <div className="wz-fg">
        <label>
          {field.label}
          {field.seed ? <span className="wz-chip">manual</span> : null}
        </label>
        <input
          type="number"
          placeholder="optional"
          value={val == null ? "" : Number(val)}
          onChange={(e) =>
            setParam(field.key, e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </div>
    );
  }

  if (field.kind === "exclude_months") {
    const arr = Array.isArray(val) ? (val as string[]) : [];
    return (
      <div className="wz-fg">
        <label>{field.label}</label>
        <input
          type="text"
          placeholder="YYYY-MM, comma-separated"
          value={arr.join(", ")}
          onChange={(e) =>
            setParam(
              field.key,
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
        <span className="wz-help">
          {historyMonths} complete months available
        </span>
      </div>
    );
  }

  return null;
}

export function ModelStudio({
  clientUserId,
  reviewId,
  reviewStatus,
  open,
  onClose,
  onSaved,
  onError,
}: Props) {
  const base = `/api/operator/treasury/clients/${clientUserId}`;
  // Studio authors every listed kind with a form — Runway (cash_model),
  // Forecast, Seasonality. (B22 gave cash_model a form + Studio create path.)
  const kinds = useMemo(
    () => listedModelKinds().filter((k) => k.form.length > 0),
    []
  );
  const [step, setStep] = useState<Step>("kind");
  const [type, setType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStep("kind");
    setType(null);
    setName("");
    setParams({});
    setPreview(null);
    setPreviewErr(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const kind = type ? getModelKind(type) : undefined;

  function chooseKind(k: ModelKindDef) {
    setType(k.type);
    setName(k.label);
    setParams(defaultParamsFor(k));
    setPreview(null);
    setPreviewErr(null);
    setStep("setup");
  }

  const setParam = useCallback((key: string, value: unknown) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  const runPreview = useCallback(async () => {
    if (!type) return;
    setLoadingPreview(true);
    setPreviewErr(null);
    try {
      const res = await fetch(`${base}/studies/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name, params, scenarios: [] }),
      });
      const j = (await res.json()) as PreviewResult & { error?: string };
      if (!res.ok) {
        setPreview(null);
        setPreviewErr(j.error ?? "Preview failed");
        return;
      }
      setPreview({ snapshot: j.snapshot, confidence: j.confidence, explain: j.explain });
    } catch {
      setPreview(null);
      setPreviewErr("Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }, [base, type, name, params]);

  // Debounced live preview while on the preview step.
  useEffect(() => {
    if (step !== "preview" || !type) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runPreview(), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [step, type, params, name, runPreview]);

  async function save(place: boolean) {
    if (!type) return;
    if (place && (!reviewId || reviewStatus !== "draft")) {
      onError("Open a draft Study before placing a Model.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${base}/studies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name, params, scenarios: [] }),
      });
      const j = (await res.json()) as { study?: { id: string }; error?: string };
      if (!res.ok || !j.study) throw new Error(j.error ?? "Save failed");
      if (place && reviewId) {
        const pr = await fetch(`${base}/reviews/${reviewId}/blocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "study", study_id: j.study.id }),
        });
        if (!pr.ok) {
          const pj = (await pr.json()) as { error?: string };
          throw new Error(pj.error ?? "Placed model failed");
        }
      }
      onSaved({ placed: place });
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const grade = preview?.confidence.grade ?? null;
  const canPlace = !!reviewId && reviewStatus === "draft" && grade !== "refused";

  return (
    <div className="wz-scrim" onClick={onClose}>
      <aside
        className="wz-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Model Studio"
        data-testid="model-studio"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wz-head">
          <div>
            <span className="wz-kicker">Model Studio</span>
            <h2>{kind ? kind.label : "New model"}</h2>
          </div>
          <button type="button" className="rcx-tool" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <nav className="wz-steps">
          <button
            type="button"
            aria-selected={step === "kind"}
            onClick={() => setStep("kind")}
          >
            1 · Kind
          </button>
          <button
            type="button"
            aria-selected={step === "setup"}
            disabled={!type}
            onClick={() => type && setStep("setup")}
          >
            2 · Set up
          </button>
          <button
            type="button"
            aria-selected={step === "preview"}
            disabled={!type}
            onClick={() => type && setStep("preview")}
          >
            3 · Preview
          </button>
        </nav>

        <div className="wz-body">
          {step === "kind" ? (
            <div className="wz-kinds">
              {kinds.map((k) => (
                <button
                  key={k.type}
                  type="button"
                  className="wz-kindcard"
                  onClick={() => chooseKind(k)}
                >
                  <span className="wz-kk">{k.family}</span>
                  <strong>{k.label}</strong>
                  <span className="wz-kd">{k.description}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === "setup" && kind ? (
            <div className="wz-form">
              <div className="wz-fg">
                <label>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              {kind.form.map((f) => (
                <Field
                  key={f.key}
                  field={f}
                  params={params}
                  historyMonths={preview?.confidence.historyMonthCount ?? 0}
                  setParam={setParam}
                />
              ))}
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="wz-prev">
              {loadingPreview && !preview ? (
                <p className="rcx-muted">Computing…</p>
              ) : null}
              {previewErr ? (
                <p className="wz-err">{previewErr}</p>
              ) : null}
              {preview ? (
                <div className="wz-prevcard" data-grade={grade ?? undefined}>
                  <div className="wz-prevhead">
                    <span className="wz-kicker">What the client will see</span>
                    <span className="wz-conf" data-grade={grade ?? undefined}>
                      {GRADE_LABEL[grade ?? ""] ?? grade}
                    </span>
                  </div>
                  <div className="wz-kpis">
                    {preview.snapshot.kpis.map((k, i) => (
                      <div key={k.id ?? i} className="wz-kpi">
                        <span className="l">{k.label}</span>
                        <span className="v">{fmtValue(k.value, k.unit)}</span>
                        {k.basis ? <span className="b">{k.basis}</span> : null}
                      </div>
                    ))}
                  </div>
                  <PreviewSpark snap={preview.snapshot} />
                  <p className="wz-note">{preview.explain}</p>
                  {preview.confidence.reasons.length ? (
                    <ul className="wz-reasons" data-grade={grade ?? undefined}>
                      {preview.confidence.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                  {grade === "refused" ? (
                    <p className="wz-err">
                      This model is refused on the current data and cannot be placed.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="wz-foot">
          {step === "kind" ? (
            <span className="rcx-muted" style={{ fontSize: 11 }}>
              Pick a kind to begin.
            </span>
          ) : (
            <>
              <button
                type="button"
                className="rcx-tool"
                onClick={() => setStep(step === "preview" ? "setup" : "kind")}
              >
                Back
              </button>
              {step === "setup" ? (
                <button
                  type="button"
                  className="rcx-btn sm"
                  onClick={() => setStep("preview")}
                >
                  Preview →
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="rcx-tool"
                    disabled={saving || !preview || grade === "refused"}
                    onClick={() => void save(false)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rcx-btn sm"
                    disabled={saving || !preview || !canPlace}
                    onClick={() => void save(true)}
                  >
                    Save &amp; place
                  </button>
                </>
              )}
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
