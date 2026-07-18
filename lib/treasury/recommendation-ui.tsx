import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type ImpactBasis,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type { RecommendationEvidence, TreasuryRecommendationRow } from "@/lib/treasury/types";

export const EXEC_STEPS: RecommendationStatus[] = ["sent", "accepted", "in_progress", "done"];

export function statusBadgeClass(status: RecommendationStatus): string {
  if (status === "sent") return "k-proposed";
  if (status === "accepted" || status === "in_progress" || status === "done") return "k-accepted";
  if (status === "declined") return "k-declined";
  return "k-muted";
}

export function formatImpactLine(rec: TreasuryRecommendationRow): string {
  if (rec.impact_amount == null) return "—";
  const currency = rec.impact_unit ?? "USD";
  const money = formatTreasuryMoney(rec.impact_amount, currency);
  const basis = rec.impact_basis ? IMPACT_BASIS_LABELS[rec.impact_basis as ImpactBasis] : "";
  return basis ? `${money} ${basis}` : money;
}

export function ExecLadder({ status }: { status: RecommendationStatus }) {
  const reached =
    status === "done" ? 3 : status === "in_progress" ? 2 : status === "accepted" ? 1 : 0;
  return (
    <div className="rec-ladder">
      {EXEC_STEPS.map((step, i) => (
        <span key={step}>
          {i > 0 ? <span className="rl-sep">›</span> : null}
          <span className={`rl-step${i <= reached ? " on" : ""}`}>
            {step === "sent" ? "Sent" : RECOMMENDATION_STATUS_LABELS[step]}
          </span>
        </span>
      ))}
    </div>
  );
}

function formatSigned(amount: number, direction?: "in" | "out" | null): string {
  const abs = formatTreasuryMoney(Math.abs(amount), "USD");
  if (direction === "in") return `+${abs}`;
  if (direction === "out") return `\u2212${abs}`;
  if (amount > 0) return `+${abs}`;
  if (amount < 0) return `\u2212${abs}`;
  return abs;
}

/**
 * Spec 40 §7 — client evidence is frozen. Render from snap only; never re-resolve.
 */
export function FrozenEvidenceList({
  evidence,
}: {
  evidence: RecommendationEvidence[];
}) {
  if (!evidence.length) return null;

  return (
    <div className="rec-evidence">
      <div className="rec-evidence-h">
        Evidence · {evidence.length} item{evidence.length === 1 ? "" : "s"}
      </div>
      {evidence.map((ev, idx) => {
        const key =
          "id" in ev && ev.id ? ev.id : `${ev.kind}-${idx}`;

        if (ev.kind === "transaction") {
          if (ev.snap) {
            const dir = ev.snap.direction;
            return (
              <div key={key} className="req-item">
                <span className="ri-d">{ev.snap.date || "—"}</span>
                <span className="ri-p">
                  <b>{ev.snap.payee || "—"}</b>
                  {ev.snap.category ? <em>{ev.snap.category}</em> : null}
                </span>
                <span className={`ri-a ${dir === "in" ? "in" : "out"}`}>
                  {formatSigned(ev.snap.amount, dir)}
                </span>
              </div>
            );
          }
          return (
            <div key={key} className="req-item req-item-missing">
              <span className="ri-d">—</span>
              <span className="ri-p">
                <b>Item no longer available</b>
              </span>
              <span className="ri-a">—</span>
            </div>
          );
        }

        if (ev.kind === "txquery" && ev.snap && typeof ev.snap === "object") {
          const snap = ev.snap as {
            description?: string;
            count?: number;
            net?: number;
            from?: string;
            to?: string;
          };
          return (
            <div key={key} className="req-item">
              <span className="ri-d">view</span>
              <span className="ri-p">
                <b>{snap.description ?? "Filtered view"}</b>
                {snap.from || snap.to ? (
                  <em>
                    {[snap.from, snap.to].filter(Boolean).join(" → ")}
                  </em>
                ) : null}
              </span>
              <span className="ri-a">
                {typeof snap.net === "number" ? formatSigned(snap.net) : "—"}
              </span>
            </div>
          );
        }

        if (ev.kind === "summary_period" && ev.snap && typeof ev.snap === "object") {
          const snap = ev.snap as {
            granularity?: string;
            from?: string;
            to?: string;
            net?: number;
            count?: number;
          };
          return (
            <div key={key} className="req-item">
              <span className="ri-d">{snap.granularity ?? "period"}</span>
              <span className="ri-p">
                <b>
                  {[snap.from, snap.to].filter(Boolean).join(" → ") || "Period"}
                </b>
                {typeof snap.count === "number" ? <em>{snap.count} tx</em> : null}
              </span>
              <span className="ri-a">
                {typeof snap.net === "number" ? formatSigned(snap.net) : "—"}
              </span>
            </div>
          );
        }

        // Other kinds: prefer snap.label if present; never live-resolve
        const snap = ev.snap as
          | { label?: string; sublabel?: string; amount?: number; direction?: "in" | "out" | null }
          | undefined;
        if (snap && typeof snap === "object" && snap.label) {
          return (
            <div key={key} className="req-item">
              <span className="ri-d">{ev.kind}</span>
              <span className="ri-p">
                <b>{snap.label}</b>
                {snap.sublabel ? <em>{snap.sublabel}</em> : null}
              </span>
              <span className="ri-a">
                {typeof snap.amount === "number"
                  ? formatSigned(snap.amount, snap.direction)
                  : "—"}
              </span>
            </div>
          );
        }

        return (
          <div key={key} className="req-item">
            <span className="ri-d">{ev.kind}</span>
            <span className="ri-p">
              <b>
                {"id" in ev && ev.id
                  ? String(ev.id).slice(0, 8)
                  : ev.kind}
              </b>
            </span>
            <span className="ri-a">—</span>
          </div>
        );
      })}
    </div>
  );
}
