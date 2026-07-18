/** Fixed locale so SSR (Node) and browser hydration produce identical strings. */
export const TREASURY_DISPLAY_LOCALE = "en-US";

export function formatTreasuryMoney(
  amount: number | null,
  currency: string | null
): string {
  if (amount == null) return "—";
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(TREASURY_DISPLAY_LOCALE, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/**
 * Ana's ledger money (Spec 35-2): always an explicit sign.
 * Minus is U+2212 MINUS SIGN. Out → ink; in → --su-pos (via class).
 * `suMoney(n)` in the demo used signed amount; we take absolute magnitude + direction.
 */
export function formatSuMoney(
  amount: number | null | undefined,
  direction?: "in" | "out" | null
): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  const abs = Math.abs(Number(amount)).toLocaleString(TREASURY_DISPLAY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  if (direction === "in") return `+$${abs}`;
  if (direction === "out") return `\u2212$${abs}`;
  const n = Number(amount);
  if (n < 0) return `\u2212$${abs}`;
  if (n > 0) return `+$${abs}`;
  return `$${abs}`;
}

export function formatTreasuryAsOf(iso: string | null): string {
  if (!iso) return "Not synced yet";
  try {
    return new Intl.DateTimeFormat(TREASURY_DISPLAY_LOCALE, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
