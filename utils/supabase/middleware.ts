import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const AUTH_ROUTES = ["/login", "/signup"];
const PUBLIC_AUTH_PATHS = ["/auth/callback", "/api/auth/google"];
const PROTECTED_PREFIXES = ["/switchboard", "/vault", "/portfolio", "/profile"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value)
        );
      },
    },
  });

  const { pathname } = request.nextUrl;
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
  const isOAuthCallback = PUBLIC_AUTH_PATHS.some((route) =>
    pathname.startsWith(route)
  );
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isOAuthCallback) {
    return supabaseResponse;
  }

  let hasSession = false;

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) {
      console.error("[auth] getClaims failed:", error.message);
    } else {
      hasSession = Boolean(data?.claims?.sub);
    }
  } catch (err) {
    console.error("[auth] session refresh network error:", err);
    // Fall through: protected routes redirect below when hasSession is false.
  }

  if (!hasSession && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && (isAuthRoute || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/switchboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
