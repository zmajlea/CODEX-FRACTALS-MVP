/**
 * Stage 5 smoke — Batch B + C Pickable → evidenceFromPickable shapes.
 * Absolute params only; no presets.
 */
import {
  evidenceFromPickable,
  type Evidence,
} from "../lib/treasury/evidence";
import type { Pickable } from "../lib/treasury/pickable";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const picks: Pickable[] = [
  {
    kind: "transaction",
    ref: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    label: "One row",
  },
  {
    kind: "rule",
    ref: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
    label: '"SELECTHEALTH" → Fees',
    sublabel: "244 suggested · 0 confirmed",
  },
  {
    kind: "summary_range",
    params: { granularity: "month", from: "2025-07-18", to: "2026-07-18" },
    label: "Summary 2025-07-18 → 2026-07-18",
  },
  {
    kind: "month",
    params: {
      month: "2025-12",
      accountId: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    label: "Month 2025-12",
  },
  {
    kind: "scenario",
    params: {
      studyId: "dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee",
      scenarioId: "eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
    label: "History repeats",
  },
  {
    kind: "account",
    ref: "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee",
    label: "Operating · 0617",
  },
  {
    kind: "forecast",
    params: { granularity: "month", asOf: "2026-07-15" },
    label: "Forecast low · Aug 2026",
  },
  {
    kind: "figure",
    params: {
      metric: "cash_position",
      from: "2026-07-15",
      to: "2026-07-15",
    },
    label: "Cash position (USD)",
  },
  {
    kind: "import",
    ref: "csv-manual",
    label: "CSV import reconcile",
    snap: { label: "CSV import reconcile", sublabel: "1086 imported" },
  },
  {
    kind: "recommendation",
    ref: "99999999-bbbb-cccc-dddd-eeeeeeeeeeee",
    label: "Prior sealed rec",
  },
];

for (const p of picks) {
  const item = evidenceFromPickable(p) as Evidence;
  assert(item.kind === p.kind, `kind mismatch for ${p.kind}`);
  if (p.kind === "import") {
    assert(
      "snap" in item && item.snap != null,
      "import must retain snap from pick"
    );
  }
  if (p.params) {
    const raw = JSON.stringify(p.params);
    assert(!/last12|ytd|preset|trailing/i.test(raw), `preset leaked in ${p.kind}`);
  }
}

console.log(`Stage 5 Batch B+C: ${picks.length} pickables OK`);
