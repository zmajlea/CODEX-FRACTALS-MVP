/**
 * Public origin for the current request (Vercel sets x-forwarded-host).
 * Never use NEXT_PUBLIC_SITE_URL here — OAuth must stay on the host the user opened.
 */
export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    if (host) return `${proto}://${host}`;
  }

  const host = request.headers.get("host");
  if (host) {
    const proto = url.protocol === "http:" ? "http" : "https";
    return `${proto}://${host}`;
  }

  return url.origin;
}

/** Client-only: where the user is actually browsing. */
export function getBrowserOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/\/$/, "");
}
