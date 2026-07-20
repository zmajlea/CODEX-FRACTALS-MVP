/** Summit operator-test tenant — illustrative portfolio chrome only. */
export function isDemoTenant(domainSlug: string | null | undefined): boolean {
  return domainSlug === "summit-test-op";
}

/** FFM Demo is the only real record on the demo tenant; other cards are illustrative. */
export const DEMO_INSTRUMENT_CLIENT_EMAIL = "ffm-demo@codexone.test";

/**
 * Prod FFM demo client id — no restore. Reset must refuse on id OR email
 * (OR, not tenant-AND) so a failed tenant lookup cannot bypass the guard.
 */
export const PROTECTED_DEMO_FFM_CLIENT_ID =
  "823560fa-1f73-4032-9c77-d390a261735f";

export function isDemoPortfolioInstrument(
  demo: boolean,
  clientEmail: string | null | undefined
): boolean {
  if (!demo) return true;
  return clientEmail?.toLowerCase() === DEMO_INSTRUMENT_CLIENT_EMAIL;
}

/** Fail-closed guard for Reset client data — refuse on id or email match. */
export function isProtectedDemoFfmClient(input: {
  clientId: string;
  clientEmail?: string | null;
}): boolean {
  if (input.clientId === PROTECTED_DEMO_FFM_CLIENT_ID) return true;
  const email = input.clientEmail?.toLowerCase();
  if (email && email === DEMO_INSTRUMENT_CLIENT_EMAIL) return true;
  return false;
}
