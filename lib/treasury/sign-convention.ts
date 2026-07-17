/**
 * Spec 32 — verify CSV Amount sign against Balance (or Type fallback).
 * No server-only imports — used from parseTreasuryCsv.
 */

export const SIGN_EPSILON = 0.02;
export const SIGN_MIN_COMPARABLE = 10;
export const SIGN_MAJORITY = 0.95;

export type SignConventionKind = "as-stated" | "inverted" | "unreconcilable";

export type SignConventionVerdict = {
  kind: SignConventionKind;
  method: "balance" | "type" | "none";
  agreeing: number;
  total: number;
  walk?: "forward" | "reversed";
  message: string;
};

/** One CSV data row after light parse — file order preserved. */
export type SignConventionRow = {
  account: string;
  amount: number;
  balance: number | null;
  type: string;
};

export class SignConventionError extends Error {
  readonly verdict: SignConventionVerdict;

  constructor(verdict: SignConventionVerdict) {
    super(verdict.message);
    this.name = "SignConventionError";
    this.verdict = verdict;
  }
}

const INFLOW_TYPES = new Set(["deposit", "refund", "credit"]);
const OUTFLOW_TYPES = new Set(["withdrawal", "fee", "check", "debit"]);

type VoteTally = {
  asStated: number;
  inverted: number;
  comparable: number;
};

function voteWalk(rows: SignConventionRow[], reversed: boolean): VoteTally {
  const byAccount = new Map<string, SignConventionRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.account) ?? [];
    list.push(row);
    byAccount.set(row.account, list);
  }

  let asStated = 0;
  let inverted = 0;
  let comparable = 0;

  for (const list of byAccount.values()) {
    const seq = reversed ? [...list].reverse() : list;
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1]!;
      const cur = seq[i]!;
      if (prev.balance == null || cur.balance == null) continue;
      if (Math.abs(cur.amount) <= 2 * SIGN_EPSILON) continue;

      comparable += 1;
      const delta = cur.balance - prev.balance;
      if (Math.abs(delta - cur.amount) <= SIGN_EPSILON) asStated += 1;
      else if (Math.abs(delta + cur.amount) <= SIGN_EPSILON) inverted += 1;
      // else: neither — stays in comparable, votes for nobody
    }
  }

  return { asStated, inverted, comparable };
}

function clearWinner(
  tally: VoteTally
): { kind: "as-stated" | "inverted"; agreeing: number } | null {
  if (tally.comparable < SIGN_MIN_COMPARABLE) return null;
  const { asStated, inverted, comparable } = tally;
  if (asStated === inverted) return null;
  if (asStated > inverted) {
    if (asStated / comparable >= SIGN_MAJORITY) {
      return { kind: "as-stated", agreeing: asStated };
    }
  } else if (inverted / comparable >= SIGN_MAJORITY) {
    return { kind: "inverted", agreeing: inverted };
  }
  return null;
}

function balanceMessage(
  kind: "as-stated" | "inverted",
  agreeing: number,
  total: number,
  walk: "forward" | "reversed"
): string {
  const walkNote = walk === "reversed" ? " (Balance walk: reversed file order)" : "";
  if (kind === "as-stated") {
    return (
      `Sign convention: negative = money out, verified against Balance on ${agreeing} of ${total} row pairs.` +
      walkNote
    );
  }
  return (
    `Sign convention: Amount column inverted relative to Balance (${agreeing} of ${total} pairs); amounts flipped before import.` +
    walkNote
  );
}

function classifyFromBalance(rows: SignConventionRow[]): SignConventionVerdict | null {
  const hasAnyBalance = rows.some((r) => r.balance != null);
  if (!hasAnyBalance) return null;

  const forward = voteWalk(rows, false);
  const forwardWin = clearWinner(forward);
  if (forwardWin) {
    return {
      kind: forwardWin.kind,
      method: "balance",
      agreeing: forwardWin.agreeing,
      total: forward.comparable,
      walk: "forward",
      message: balanceMessage(
        forwardWin.kind,
        forwardWin.agreeing,
        forward.comparable,
        "forward"
      ),
    };
  }

  const reversed = voteWalk(rows, true);
  const reverseWin = clearWinner(reversed);
  if (reverseWin) {
    return {
      kind: reverseWin.kind,
      method: "balance",
      agreeing: reverseWin.agreeing,
      total: reversed.comparable,
      walk: "reversed",
      message: balanceMessage(
        reverseWin.kind,
        reverseWin.agreeing,
        reversed.comparable,
        "reversed"
      ),
    };
  }

  // Adequate sample on either walk but no clear majority → refuse (do not Type-fallback)
  if (
    forward.comparable >= SIGN_MIN_COMPARABLE ||
    reversed.comparable >= SIGN_MIN_COMPARABLE
  ) {
    const best = forward.comparable >= reversed.comparable ? forward : reversed;
    return {
      kind: "unreconcilable",
      method: "balance",
      agreeing: Math.max(best.asStated, best.inverted),
      total: best.comparable,
      message:
        `Sign convention unreconcilable against Balance (${Math.max(best.asStated, best.inverted)} of ${best.comparable} pairs agreed; need ≥${Math.round(SIGN_MAJORITY * 100)}%). Import refused.`,
    };
  }

  // comparablePairs < 10 on both walks → fall through to Type
  return null;
}

function signOf(n: number): -1 | 1 | 0 {
  if (n > SIGN_EPSILON) return 1;
  if (n < -SIGN_EPSILON) return -1;
  return 0;
}

function classifyFromType(rows: SignConventionRow[]): SignConventionVerdict {
  const inflowSigns = new Set<-1 | 1>();
  const outflowSigns = new Set<-1 | 1>();

  for (const row of rows) {
    const t = row.type.toLowerCase().trim();
    const s = signOf(row.amount);
    if (s === 0) continue;
    if (INFLOW_TYPES.has(t)) inflowSigns.add(s);
    else if (OUTFLOW_TYPES.has(t)) outflowSigns.add(s);
    // transfer / other excluded
  }

  if (inflowSigns.size !== 1 || outflowSigns.size !== 1) {
    return {
      kind: "unreconcilable",
      method: "type",
      agreeing: 0,
      total: 0,
      message:
        "Sign convention unreconcilable: no Balance column (or too few Balance pairs) and Type signs are ambiguous. Import refused.",
    };
  }

  const inflowSign = [...inflowSigns][0]!;
  const outflowSign = [...outflowSigns][0]!;
  if (inflowSign === outflowSign) {
    return {
      kind: "unreconcilable",
      method: "type",
      agreeing: 0,
      total: 0,
      message:
        "Sign convention unreconcilable: deposit and withdrawal Types share the same Amount sign. Import refused.",
    };
  }

  // Bank convention we treat as as-stated: negative = money out
  const asStated = outflowSign === -1 && inflowSign === 1;
  const kind: "as-stated" | "inverted" = asStated ? "as-stated" : "inverted";
  const typedRows = rows.filter((r) => {
    const t = r.type.toLowerCase().trim();
    return INFLOW_TYPES.has(t) || OUTFLOW_TYPES.has(t);
  }).length;

  if (kind === "as-stated") {
    return {
      kind,
      method: "type",
      agreeing: typedRows,
      total: typedRows,
      message:
        "Sign convention: negative = money out, verified via Type column (deposits vs withdrawals).",
    };
  }
  return {
    kind,
    method: "type",
    agreeing: typedRows,
    total: typedRows,
    message:
      "Sign convention: Amount signs inverted relative to Type (deposits vs withdrawals); amounts flipped before import.",
  };
}

/**
 * Classify file sign convention. Caller flips amounts on inverted; throws/refuses on unreconcilable.
 */
export function classifySignConvention(
  rows: SignConventionRow[]
): SignConventionVerdict {
  if (rows.length === 0) {
    return {
      kind: "unreconcilable",
      method: "none",
      agreeing: 0,
      total: 0,
      message: "Sign convention unreconcilable: no data rows. Import refused.",
    };
  }

  const hasSignedAmounts = rows.some((r) => r.amount < -SIGN_EPSILON);

  // Legacy unsigned Absolute Amounts: Type drives direction; there is no Amount sign to verify.
  if (!hasSignedAmounts) {
    return {
      kind: "as-stated",
      method: "type",
      agreeing: rows.length,
      total: rows.length,
      message:
        "Sign convention: unsigned Amounts; direction taken from Type (legacy MVP).",
    };
  }

  const fromBalance = classifyFromBalance(rows);
  if (fromBalance) return fromBalance;
  return classifyFromType(rows);
}
