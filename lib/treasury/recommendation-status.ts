export const RECOMMENDATION_CATEGORIES = [
  "liquidity",
  "cost",
  "financing",
  "risk",
] as const;

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export const RECOMMENDATION_CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  liquidity: "Liquidity",
  cost: "Cost",
  financing: "Financing",
  risk: "Risk",
};

export const RECOMMENDATION_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "in_progress",
  "done",
  "declined",
] as const;

export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  draft: "Draft",
  sent: "Awaiting response",
  accepted: "Accepted",
  in_progress: "In progress",
  done: "Done",
  declined: "Declined",
};

export const IMPACT_BASIS_OPTIONS = ["per_month", "per_year", "one_time"] as const;

export type ImpactBasis = (typeof IMPACT_BASIS_OPTIONS)[number];

export const IMPACT_BASIS_LABELS: Record<ImpactBasis, string> = {
  per_month: "per month",
  per_year: "per year",
  one_time: "one time",
};

export const DECLINE_REASONS = [
  "Not the right time",
  "Timing is fixed",
  "Prefer a different approach",
  "Not a priority now",
  "Need more detail",
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number];

export type RecommendationActor = "operator" | "client";

const TERMINAL: RecommendationStatus[] = ["done", "declined"];

export function isTerminalStatus(status: RecommendationStatus): boolean {
  return TERMINAL.includes(status);
}

export function canTransition(
  from: RecommendationStatus,
  to: RecommendationStatus,
  actor: RecommendationActor
): boolean {
  if (from === to) return false;
  if (isTerminalStatus(from)) return false;

  if (actor === "operator") {
    if (from === "draft" && to === "sent") return true;
    if (from === "accepted" && to === "in_progress") return true;
    if (from === "in_progress" && to === "done") return true;
    return false;
  }

  // Client: accept/decline a recommendation, or answer a question (sent → done)
  if (from === "sent" && (to === "accepted" || to === "declined" || to === "done")) {
    return true;
  }
  return false;
}

export function actionToStatus(
  action: string,
  current: RecommendationStatus
): RecommendationStatus | null {
  switch (action) {
    case "send":
      return current === "draft" ? "sent" : null;
    case "accept":
      return current === "sent" ? "accepted" : null;
    case "decline":
      return current === "sent" ? "declined" : null;
    case "answer":
      return current === "sent" ? "done" : null;
    case "mark_in_progress":
      return current === "accepted" ? "in_progress" : null;
    case "mark_done":
      return current === "in_progress" ? "done" : null;
    default:
      return null;
  }
}

export function isDeclineReason(value: string): value is DeclineReason {
  return (DECLINE_REASONS as readonly string[]).includes(value);
}

export function isRecommendationCategory(value: string): value is RecommendationCategory {
  return (RECOMMENDATION_CATEGORIES as readonly string[]).includes(value);
}

export function isImpactBasis(value: string): value is ImpactBasis {
  return (IMPACT_BASIS_OPTIONS as readonly string[]).includes(value);
}
