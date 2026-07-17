import type { TreasuryTransactionRow } from "@/lib/treasury/types";

export type CashflowLine = {
  name: string;
  amount: number;
};

export type PeriodDecomposition = {
  receipts: CashflowLine[];
  disbursements: CashflowLine[];
  recTotal: number;
  disbTotal: number;
  net: number;
};

export type ContributorLine = {
  name: string;
  amount: number;
  direction: "in" | "out";
};

function labelKey(tx: TreasuryTransactionRow): string {
  const trimmed = tx.label?.trim();
  return trimmed ? trimmed : "Unlabeled";
}

export function aggregateByLabel(
  transactions: TreasuryTransactionRow[]
): PeriodDecomposition {
  const receiptMap = new Map<string, number>();
  const disbMap = new Map<string, number>();

  for (const tx of transactions) {
    const label = labelKey(tx);
    const amt = Math.abs(Number(tx.amount));
    if (tx.direction === "in") {
      receiptMap.set(label, (receiptMap.get(label) ?? 0) + amt);
    } else if (tx.direction === "out") {
      disbMap.set(label, (disbMap.get(label) ?? 0) + amt);
    }
  }

  const receipts = [...receiptMap.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const disbursements = [...disbMap.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const recTotal = receipts.reduce((s, r) => s + r.amount, 0);
  const disbTotal = disbursements.reduce((s, d) => s + d.amount, 0);

  return {
    receipts,
    disbursements,
    recTotal,
    disbTotal,
    net: recTotal - disbTotal,
  };
}

export function topContributors(
  transactions: TreasuryTransactionRow[],
  limit = 5
): ContributorLine[] {
  const byLabel = new Map<string, { in: number; out: number }>();

  for (const tx of transactions) {
    const label = labelKey(tx);
    const entry = byLabel.get(label) ?? { in: 0, out: 0 };
    const amt = Math.abs(Number(tx.amount));
    if (tx.direction === "in") entry.in += amt;
    else if (tx.direction === "out") entry.out += amt;
    byLabel.set(label, entry);
  }

  const lines: ContributorLine[] = [];
  for (const [name, { in: inAmt, out: outAmt }] of byLabel) {
    if (inAmt > 0) lines.push({ name, amount: inAmt, direction: "in" });
    if (outAmt > 0) lines.push({ name, amount: outAmt, direction: "out" });
  }

  return lines.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export function contributorsFromLines(
  lines: { name: string; amount: number; direction: "in" | "out" }[],
  limit = 5
): ContributorLine[] {
  return [...lines]
    .filter((l) => l.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
