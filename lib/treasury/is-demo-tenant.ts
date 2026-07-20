/** Summit operator-test tenant — illustrative portfolio chrome only. */
export function isDemoTenant(domainSlug: string | null | undefined): boolean {
  return domainSlug === "summit-test-op";
}

/** FFM Demo is the only real record on the demo tenant; other cards are illustrative. */
export const DEMO_INSTRUMENT_CLIENT_EMAIL = "ffm-demo@codexone.test";

export function isDemoPortfolioInstrument(
  demo: boolean,
  clientEmail: string | null | undefined
): boolean {
  if (!demo) return true;
  return clientEmail?.toLowerCase() === DEMO_INSTRUMENT_CLIENT_EMAIL;
}
