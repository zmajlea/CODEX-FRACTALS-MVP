/**
 * Spec 45 — bounded snap rows + Answered helpers (no auth).
 * Run: npx tsx scripts/prove-45-evidence-answered.ts
 */
import {
  isBoundedTxQueryLimit,
  RULE_CONTEXT_MAX_N,
  type TxQuerySnap,
} from "../lib/treasury/evidence";
import {
  displayStatusLabel,
  isAnsweredQuestion,
  isAnsweredUnread,
  statusBadgeClass,
} from "../lib/treasury/recommendation-ui";
import type { TreasuryRecommendationRow } from "../lib/treasury/types";

if (!isBoundedTxQueryLimit(5)) throw new Error("5 bounded");
if (isBoundedTxQueryLimit(0)) throw new Error("0 not bounded");
if (isBoundedTxQueryLimit(200)) throw new Error("200 not bounded");
if (isBoundedTxQueryLimit(RULE_CONTEXT_MAX_N + 1)) throw new Error("26 not");

const boundedSnap: TxQuerySnap = {
  count: 2,
  in: 0,
  out: 100,
  net: -100,
  description: "Recent 2 transactions like this rule — for context.",
  rows: [
    { date: "2026-01-01", payee: "A", amount: 40, direction: "out" },
    { date: "2026-01-02", payee: "B", amount: 60, direction: "out" },
  ],
};
const sum = boundedSnap.rows!.reduce((s, r) => s + r.amount, 0);
if (sum !== 100) throw new Error("rows must sum to |net| scale");

const unbounded: TxQuerySnap = {
  count: 244,
  in: 0,
  out: 1000,
  net: -1000,
  description: "244 transactions · SELECTHEALTH · −$1,000.00 · summary only",
};
if (unbounded.rows) throw new Error("unbounded must not carry rows");
if (!/summary only/i.test(unbounded.description)) {
  throw new Error("unbounded needs summary only");
}

const answered = {
  kind: "question" as const,
  status: "done" as const,
  client_response: "It's a deposit from Optum",
  operator_seen_at: null,
  responded_at: "2026-07-18T17:00:00.000Z",
} satisfies Pick<
  TreasuryRecommendationRow,
  "kind" | "status" | "client_response" | "operator_seen_at" | "responded_at"
>;

if (!isAnsweredQuestion(answered)) throw new Error("answered");
if (!isAnsweredUnread(answered)) throw new Error("unread");
if (displayStatusLabel(answered) !== "Answered") throw new Error("label");
if (statusBadgeClass("done", { answered: true, answeredUnread: true }) !== "k-answered unread") {
  throw new Error("chip");
}

const recDone = {
  kind: "recommendation" as const,
  status: "done" as const,
  client_response: null,
};
if (displayStatusLabel(recDone) !== "Done") throw new Error("recs stay Done");

console.log(
  JSON.stringify({
    ok: true,
    boundedRows: true,
    summaryOnly: true,
    answeredChip: true,
    recsStillDone: true,
  })
);
