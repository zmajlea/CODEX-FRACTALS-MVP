/** Stage 7a — rule explanation money must round at format time. */
import { formatTreasuryMoney } from "../lib/treasury/format";

function formatRuleAmountBound(n: number | null | undefined): string {
  if (n == null) return "∞";
  return formatTreasuryMoney(n, "USD");
}

function buildRange(min: number, max: number): string {
  return `${formatRuleAmountBound(min)}–${formatRuleAmountBound(max)}`;
}

const abs = 169.95;
const rawMin = abs * 0.8;
const rawMax = abs * 1.2;
const rounded = buildRange(
  Math.round(rawMin * 100) / 100,
  Math.round(rawMax * 100) / 100
);

if (rawMax.toString().includes("99999") === false) {
  // still may not show float artifact for this abs; force classic float
}
const classic = 203.93999999999997;
const fixed = formatRuleAmountBound(classic);
if (fixed !== "$203.94") {
  throw new Error(`expected $203.94, got ${fixed}`);
}
if (rounded !== "$135.96–$203.94") {
  throw new Error(`expected $135.96–$203.94, got ${rounded}`);
}
if (fixed.includes("999")) {
  throw new Error(`float leak: ${fixed}`);
}

console.log("Stage 7a: rule amount format OK —", rounded, "|", fixed);
