/**
 * Canonical app URL for OAuth redirects (Supabase allow-list must include this origin).
 *
 * Request/browser origin wins when provided so production never inherits
 * NEXT_PUBLIC_SITE_URL=http://localhost:14000 from a misconfigured Vercel env.
 */
export function getSiteUrl(preferredOrigin?: string): string {
  if (preferredOrigin) {
    try {
      const { origin, protocol } = new URL(preferredOrigin);
      if (protocol === "http:" || protocol === "https:") {
        return origin;
      }
    } catch {
      /* fall through */
    }
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(
    /\/$/,
    ""
  );
  if (vercelProduction) {
    return vercelProduction.startsWith("http")
      ? vercelProduction
      : `https://${vercelProduction}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:14000";
}
