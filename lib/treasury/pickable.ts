/** Spec 40 — portable pick contract. No server-only. */

export type EvidenceKind =
  | "transaction"
  | "study"
  | "backtest"
  | "rule"
  | "account"
  | "import"
  | "recommendation"
  | "txquery"
  | "summary_period"
  | "summary_range"
  | "month"
  | "scenario"
  | "forecast"
  | "figure";

/**
 * Something the operator can pick into a draft.
 * Recipes must store ABSOLUTE values in params — never preset names.
 */
export type Pickable = {
  kind: EvidenceKind;
  /** Row id for reference picks */
  ref?: string;
  /** Recipe params — absolute dates/ids only */
  params?: Record<string, unknown>;
  /** One line — what the rail shows */
  label: string;
  /** One line — the number that matters */
  sublabel?: string;
};

export type DraftKind = "recommendation" | "question";

export function assertAbsolutePickParams(params: Record<string, unknown> | undefined): void {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string") continue;
    const lower = value.toLowerCase();
    if (
      lower === "last12" ||
      lower === "last_12" ||
      lower === "ytd" ||
      lower === "mtd" ||
      lower.startsWith("preset") ||
      lower.includes("last_") ||
      /^last\d+/.test(lower)
    ) {
      throw new Error(`Pick params must be absolute — refused relative value for ${key}: ${value}`);
    }
  }
}
