/**
 * Spec 44 — helper / label / clamp gate (no auth).
 * Run: npx tsx scripts/prove-44-rule-context.ts
 */
import {
  buildRuleContextTxQueryParams,
  clampRuleContextN,
  replaceRuleContextCompanions,
  ruleContextLabel,
  type Evidence,
} from "../lib/treasury/evidence";
import { assertAbsolutePickParams } from "../lib/treasury/pickable";

if (clampRuleContextN(0) !== null) throw new Error("reject 0");
if (clampRuleContextN(200) !== null) throw new Error("reject 200");
if (clampRuleContextN(10) !== 10) throw new Error("accept 10");

const p = buildRuleContextTxQueryParams(
  {
    id: "r1",
    match_merchant: "SELECTHEALTH",
    amount_min: null,
    amount_max: null,
    direction: "out",
  },
  5
);
assertAbsolutePickParams(p);
if (p.limit !== 5 || p.contextForRuleId !== "r1" || p.direction !== "out") {
  throw new Error(`bad params ${JSON.stringify(p)}`);
}

const label = ruleContextLabel(5);
if (/matching this rule/i.test(label)) {
  throw new Error(`overclaim label: ${label}`);
}
if (!/like this rule/i.test(label)) {
  throw new Error(`expected like-this-rule label: ${label}`);
}

const ev: Evidence[] = [{ kind: "txquery", id: "c1", params: p }];
const next = replaceRuleContextCompanions(
  ev,
  10,
  new Map([
    [
      "r1",
      {
        id: "r1",
        match_merchant: "SELECTHEALTH",
        amount_min: null,
        amount_max: null,
        direction: "out",
      },
    ],
  ])
);
if (next[0].kind !== "txquery" || next[0].params.limit !== 10) {
  throw new Error("replace N failed");
}

console.log(
  JSON.stringify({
    ok: true,
    label,
    absolute: true,
    clamp: { reject0: true, reject200: true, accept10: true },
  })
);
