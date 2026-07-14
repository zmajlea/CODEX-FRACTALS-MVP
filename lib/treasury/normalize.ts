/** Normalize merchant/payee strings for rule matching. */
export function normalizeMerchant(raw: string | null | undefined, merchant?: string | null): string {
  const base = (merchant?.trim() || raw?.trim() || "").toUpperCase();
  if (!base) return "";

  let s = base;
  s = s.replace(/\bACH\s+(DEBIT|CREDIT)\b/gi, "");
  s = s.replace(/\bPOS\b/gi, "");
  s = s.replace(/\bDEBIT\s+CARD\s+#?\d+\b/gi, "");
  s = s.replace(/\bCHECK\s+#?\d+\b/gi, "");
  s = s.replace(/\bREF\s*#?\d+\b/gi, "");
  s = s.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function amountToDirection(amount: number): "in" | "out" {
  // Plaid: positive = money out of account (debit), negative = inflow
  return amount > 0 ? "out" : "in";
}
