import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import {
  ffRouteGuardRedirect,
  isClientPath,
  isDistributorPath,
  isGlobalAdminPath,
  isPlatformProtectedPath,
  parseFfLoginRoute,
} from "@/lib/ff/routing";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const AUTH_ROUTES = ["/login", "/signup"];
const PUBLIC_AUTH_PATHS = ["/auth/callback", "/api/auth/google"];

async function fetchFfLoginRoute(
  supabase: ReturnType<typeof createServerClient<Database>>
) {
  try {
    const { data, error } = await supabase.rpc("get_ff_login_route");
    if (error) {
      console.error("[ff] get_ff_login_route failed:", error.message);
      return { route: "/login", role: "none" as const };
    }
    return parseFfLoginRoute(data);
  } catch (err) {
    console.error("[ff] get_ff_login_route network error:", err);
    return { route: "/login", role: "none" as const };
  }
}

function resolveSafeNext(
  next: string | null,
  loginRoute: ReturnType<typeof parseFfLoginRoute>
): string {
  if (!next || !next.startsWith("/")) {
    return loginRoute.route;
  }

  const qIndex = next.indexOf("?");
  const pathOnly = qIndex === -1 ? next : next.slice(0, qIndex);
  const query = qIndex === -1 ? "" : next.slice(qIndex);

  if (AUTH_ROUTES.some((route) => pathOnly.startsWith(route))) {
    return loginRoute.route;
  }

  const guard = ffRouteGuardRedirect(pathOnly, loginRoute);
  if (guard) return guard;

  return `${pathOnly}${query}`;
}

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
  const isProtected = isPlatformProtectedPath(pathname);

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
  }

  if (!hasSession && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (hasSession) {
    const loginRoute = await fetchFfLoginRoute(supabase);

    if (isAuthRoute || pathname === "/") {
      const url = request.nextUrl.clone();
      const next = request.nextUrl.searchParams.get("next");
      const target =
        isAuthRoute && next ? resolveSafeNext(next, loginRoute) : loginRoute.route;
      const qIndex = target.indexOf("?");
      url.pathname = qIndex === -1 ? target : target.slice(0, qIndex);
      url.search = qIndex === -1 ? "" : target.slice(qIndex);
      return NextResponse.redirect(url);
    }

    const guard = ffRouteGuardRedirect(pathname, loginRoute);
    if (guard) {
      const url = request.nextUrl.clone();
      const qIndex = guard.indexOf("?");
      url.pathname = qIndex === -1 ? guard : guard.slice(0, qIndex);
      url.search = qIndex === -1 ? "" : guard.slice(qIndex);
      if (url.pathname !== pathname || url.search !== request.nextUrl.search) {
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
