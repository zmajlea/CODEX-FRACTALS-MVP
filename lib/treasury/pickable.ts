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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
/** UUID or opaque row id (hex/uuid-ish / cuid-ish) — not a relative preset word. */
const ID_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;

const DATE_KEYS = new Set([
  "from",
  "to",
  "asOf",
  "as_of",
  "posted_date",
  "date",
  "endDate",
  "startDate",
]);

const MONTH_KEYS = new Set([
  "startMonth",
  "endMonth",
  "month",
  "backtestStartMonth",
]);

const ID_KEYS = new Set([
  "accountId",
  "studyId",
  "scenarioId",
  "ruleId",
  "importId",
  "recommendationId",
  "ref",
]);

const ID_ARRAY_KEYS = new Set(["accountIds"]);

const ENUM_ALLOW: Record<string, readonly string[]> = {
  status: ["all", "needs_label", "suggested", "labeled"],
  granularity: ["day", "week", "month", "year"],
  ruleQueue: ["suggested", "confirmed", "rejected"],
  direction: ["in", "out"],
};

/** Free-text search / human description — still reject relative range tokens. */
const FREE_TEXT_KEYS = new Set(["q", "description", "label", "sublabel"]);

function looksLikeRelativeRangeToken(value: string): boolean {
  const lower = value.toLowerCase().trim();
  if (
    lower === "last12" ||
    lower === "last_12" ||
    lower === "ytd" ||
    lower === "mtd" ||
    lower === "qtd" ||
    lower === "trailing6" ||
    lower === "all" ||
    lower === "12m" ||
    lower === "90d" ||
    lower.startsWith("preset") ||
    lower.includes("last_") ||
    /^last\d+/.test(lower) ||
    /^trailing\d+/.test(lower)
  ) {
    return true;
  }
  return false;
}

function assertStringShape(key: string, value: string): void {
  if (DATE_KEYS.has(key)) {
    if (!ISO_DATE.test(value)) {
      throw new Error(
        `Pick params must be absolute ISO dates — refused ${key}: ${value}`
      );
    }
    return;
  }
  if (MONTH_KEYS.has(key)) {
    if (!ISO_MONTH.test(value) && !ISO_DATE.test(value)) {
      throw new Error(
        `Pick params must be absolute months (YYYY-MM) — refused ${key}: ${value}`
      );
    }
    return;
  }
  if (ID_KEYS.has(key) || key.endsWith("Id")) {
    if (!ID_SHAPE.test(value) || looksLikeRelativeRangeToken(value)) {
      throw new Error(`Pick params: invalid id for ${key}: ${value}`);
    }
    return;
  }
  if (key in ENUM_ALLOW) {
    if (!ENUM_ALLOW[key].includes(value)) {
      throw new Error(`Pick params: invalid ${key}: ${value}`);
    }
    return;
  }
  if (FREE_TEXT_KEYS.has(key)) {
    if (looksLikeRelativeRangeToken(value)) {
      throw new Error(
        `Pick params must be absolute — refused relative value for ${key}: ${value}`
      );
    }
    return;
  }
  // Unknown string keys: allowlist by shape only (date, month, or id).
  if (ISO_DATE.test(value) || ISO_MONTH.test(value) || ID_SHAPE.test(value)) {
    if (looksLikeRelativeRangeToken(value)) {
      throw new Error(
        `Pick params must be absolute — refused relative value for ${key}: ${value}`
      );
    }
    return;
  }
  throw new Error(
    `Pick params: unrecognized shape for ${key} (want ISO date, month, id, or known enum) — got: ${value}`
  );
}

function assertParamValue(key: string, value: unknown): void {
  if (value == null) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Pick params: non-finite number for ${key}`);
    }
    return;
  }
  if (typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (ID_ARRAY_KEYS.has(key) || key.endsWith("Ids") || key.endsWith("Ids[]")) {
      for (const item of value) {
        if (typeof item !== "string" || !ID_SHAPE.test(item)) {
          throw new Error(`Pick params: invalid id in ${key}`);
        }
      }
      return;
    }
    for (const item of value) assertParamValue(key, item);
    return;
  }
  if (typeof value === "string") {
    assertStringShape(key, value);
    return;
  }
  throw new Error(`Pick params: unsupported type for ${key}`);
}

/**
 * Allowlist-by-shape: dates must be ISO, months YYYY-MM, ids id-shaped,
 * numbers ok, known enums ok. Unknown relative tokens fail by default —
 * including tomorrow's presets (trailing6, qtd, …).
 */
export function assertAbsolutePickParams(
  params: Record<string, unknown> | undefined
): void {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    assertParamValue(key, value);
  }
}
