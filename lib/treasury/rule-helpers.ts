import type { TreasuryRuleRow } from "@/lib/treasury/types";

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  let matches = 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / maxLen;
}

export function merchantMatches(normalized: string, rule: TreasuryRuleRow): boolean {
  const match = rule.match_merchant.toUpperCase();
  const target = normalized.toUpperCase();
  if (rule.match_type === "exact") return target === match;
  if (rule.match_type === "fuzzy") {
    if (!target || !match) return false;
    const longer = target.length >= match.length ? target : match;
    const shorter = target.length < match.length ? target : match;
    return longer.includes(shorter) || similarity(target, match) > 0.55;
  }
  return target.includes(match);
}

export type CadenceDetection = {
  kind: "weekly" | "biweekly" | "monthly" | "quarterly" | "irregular";
  medianGapDays: number;
  label: string;
};

export function detectCadence(dates: string[]): CadenceDetection {
  if (dates.length < 2) {
    return { kind: "irregular", medianGapDays: 0, label: "irregular" };
  }
  const sorted = [...dates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d0 = new Date(sorted[i - 1]! + "T12:00:00Z").getTime();
    const d1 = new Date(sorted[i]! + "T12:00:00Z").getTime();
    gaps.push(Math.round((d1 - d0) / (1000 * 60 * 60 * 24)));
  }
  gaps.sort((a, b) => a - b);
  const medianGapDays = gaps[Math.floor(gaps.length / 2)] ?? 0;

  if (medianGapDays >= 84 && medianGapDays <= 95) {
    return { kind: "quarterly", medianGapDays, label: "quarterly ±5 days" };
  }
  if (medianGapDays >= 28 && medianGapDays <= 33) {
    return { kind: "monthly", medianGapDays, label: "monthly ±4 days" };
  }
  if (medianGapDays >= 13 && medianGapDays <= 16) {
    return { kind: "biweekly", medianGapDays, label: "biweekly ±2 days" };
  }
  if (medianGapDays >= 6 && medianGapDays <= 8) {
    return { kind: "weekly", medianGapDays, label: "weekly ±1 day" };
  }
  return { kind: "irregular", medianGapDays, label: "irregular" };
}
