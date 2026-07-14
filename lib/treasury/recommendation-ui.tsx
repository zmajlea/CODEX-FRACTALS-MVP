import { formatTreasuryMoney } from "@/lib/treasury/format";
import {
  IMPACT_BASIS_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  type ImpactBasis,
  type RecommendationStatus,
} from "@/lib/treasury/recommendation-status";
import type { TreasuryRecommendationRow } from "@/lib/treasury/types";

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
