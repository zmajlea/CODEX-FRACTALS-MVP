import type { TreasuryInstitutionView } from "@/lib/treasury/types";

export function sumBalancesByCurrency(
  institutions: TreasuryInstitutionView[]
): [string, number][] {
  const map = new Map<string, number>();
  for (const inst of institutions) {
    for (const acct of inst.accounts) {
      const code = acct.iso_currency_code ?? "USD";
      const bal = acct.current_balance ?? 0;
      map.set(code, (map.get(code) ?? 0) + bal);
    }
  }
  return [...map.entries()];
}
