const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "login",
  "signup",
]);

const RESERVED_ROOT_SEGMENTS = new Set([
  "login",
  "signup",
  "portal",
  "switchboard",
  "vault",
  "portfolio",
  "profile",
  "auth",
  "api",
  "admin",
  "operator",
  "client",
  "_next",
  "favicon.ico",
]);

/** Extract tenant subdomain from Host header (production or local dev). */
export function extractTenantSubdomain(host: string): string | null {
  const hostname = (host.split(":")[0] ?? "").toLowerCase();
  const baseDomain = (
    process.env.FF_BASE_DOMAIN ?? "fractals.com"
  ).toLowerCase();

  if (hostname.endsWith(".localhost")) {
    const sub = hostname.replace(/\.localhost$/, "");
    if (!sub || RESERVED_SUBDOMAINS.has(sub)) return null;
    return sub;
  }

  if (hostname.endsWith(`.${baseDomain}`)) {
    const sub = hostname.slice(0, -(baseDomain.length + 1));
    if (!sub || sub.includes(".") || RESERVED_SUBDOMAINS.has(sub)) return null;
    return sub;
  }

  return null;
}

export function isReservedRootSegment(segment: string): boolean {
  return RESERVED_ROOT_SEGMENTS.has(segment.toLowerCase());
}
