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
