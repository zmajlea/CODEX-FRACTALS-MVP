import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const AUTH_ROUTES = ["/login", "/signup"];
const PUBLIC_AUTH_PATHS = ["/auth/callback"];
const PROTECTED_PREFIXES = ["/switchboard", "/vault", "/portfolio"];

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
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (isAuthRoute || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/switchboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
