/** Edge-safe role helpers — no next/navigation or Node APIs. */

export type CommercialTier = "global_admin" | "operator" | "client" | "none";

const CODEXONE_DOMAIN = "@codexone.io";

/** Legacy DB rows may still use distributor until migrations are applied everywhere. */
export function normalizeCommercialRole(
  role: string | null | undefined
): CommercialTier | null {
  if (role === "global_admin") return "global_admin";
  if (role === "operator" || role === "distributor") return "operator";
  if (role === "client") return "client";
  if (role === "none") return "none";
  return null;
}

export function isOperatorRole(role: string | null | undefined): boolean {
  return role === "operator" || role === "distributor";
}

export function isCodexOneEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(CODEXONE_DOMAIN));
}

export const PORTAL_LOGIN = "/portal/login";
export const CLIENT_LOGIN = "/client/login";
export const CLIENT_SIGNUP = "/client/signup";
