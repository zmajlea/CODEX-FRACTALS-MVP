/**
 * Spec 65 Part H — transaction split slices (shared validation).
 */

export type TransactionSplitSlice = {
  label: string;
  amount: number;
};

export const SPLIT_SUM_TOLERANCE = 0.01;

export function validateSplitSlices(
  txAmount: number,
  slices: TransactionSplitSlice[]
): string | null {
  if (slices.length === 0) return null;
  for (const s of slices) {
    if (!s.label?.trim()) return "Each slice needs a label";
    if (!Number.isFinite(s.amount)) return "Each slice needs a numeric amount";
  }
  const sum = slices.reduce((acc, s) => acc + s.amount, 0);
  if (Math.abs(sum - txAmount) > SPLIT_SUM_TOLERANCE) {
    return `Slices must sum to transaction amount (${txAmount}); got ${sum}`;
  }
  return null;
}
