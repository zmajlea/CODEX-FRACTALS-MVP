import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import {
  extractTenantSubdomain,
  isReservedRootSegment,
} from "@/lib/ff/subdomain";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const subdomain = extractTenantSubdomain(host);
  const { pathname } = request.nextUrl;

  if (subdomain) {
    const alreadyPrefixed =
      pathname === `/${subdomain}` || pathname.startsWith(`/${subdomain}/`);

    if (!alreadyPrefixed) {
      const url = request.nextUrl.clone();
      url.pathname =
        pathname === "/" ? `/${subdomain}` : `/${subdomain}${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (
    first &&
    !isReservedRootSegment(first) &&
    segments.length === 1 &&
    !subdomain
  ) {
    // Path-based tenant landing: /demo → /demo (no rewrite needed)
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
