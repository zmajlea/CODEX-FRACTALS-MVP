import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { CLIENT_LOGIN, PORTAL_LOGIN } from "@/lib/auth/roles";
import {
  ffRouteGuardRedirect,
  isClientPath,
  isDistributorPath,
  isGlobalAdminPath,
  isPlatformProtectedPath,
  parseBcnLoginRoute,
} from "@/lib/bcn/routing";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/portal/login",
  "/client/login",
  "/client/signup",
];
const PUBLIC_AUTH_PATHS = ["/auth/callback", "/api/auth/google"];

function authRouteHome(
  pathname: string,
  loginRoute: ReturnType<typeof parseBcnLoginRoute>
): string | null {
  if (pathname === "/login" || pathname === "/signup") {
    if (loginRoute.role === "global_admin") return "/admin";
    if (loginRoute.role === "operator") return "/operator";
    if (loginRoute.role === "client") return loginRoute.route;
    return null;
  }

  if (pathname.startsWith("/portal/login")) {
    if (loginRoute.role === "global_admin") return "/admin";
    if (loginRoute.role === "operator") return "/operator";
    return null;
  }

  if (pathname.startsWith("/client/login") || pathname.startsWith("/client/signup")) {
    if (loginRoute.role === "client") return loginRoute.route;
    // Stay on client auth pages — form shows Operator vs client messaging
    return null;
  }

  return loginRoute.route;
}

function hasInviteParam(request: NextRequest): boolean {
  return Boolean(request.nextUrl.searchParams.get("invite"));
}

async function fetchBcnLoginRoute(
  supabase: ReturnType<typeof createServerClient<Database>>
) {
  try {
    const { data, error } = await supabase.rpc("get_ff_login_route");
    if (error) {
      console.error("[ff] get_ff_login_route failed:", error.message);
      return { route: "/login", role: "none" as const };
    }
    return parseBcnLoginRoute(data);
  } catch (err) {
    console.error("[ff] get_ff_login_route network error:", err);
    return { route: "/login", role: "none" as const };
  }
}

function resolveSafeNext(
  next: string | null,
  loginRoute: ReturnType<typeof parseBcnLoginRoute>
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

  if (pathOnly === "/switchboard") {
    return loginRoute.route;
  }

  const guard = ffRouteGuardRedirect(pathOnly, loginRoute);
  if (guard) return guard;

  return `${pathOnly}${query}`;
}

function protectedLoginPath(pathname: string): string {
  if (isGlobalAdminPath(pathname) || isDistributorPath(pathname)) {
    return `${PORTAL_LOGIN}?next=${encodeURIComponent(pathname)}`;
  }
  if (isClientPath(pathname)) {
    return `${CLIENT_LOGIN}?next=${encodeURIComponent(pathname)}`;
  }
  return `/login?next=${encodeURIComponent(pathname)}`;
}

export async function updateSession(request: NextRequest) {
  try {
    return await updateSessionInner(request);
  } catch (err) {
    console.error("[auth] middleware crashed:", err);
    return NextResponse.next({ request });
  }
}

async function updateSessionInner(request: NextRequest) {
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
    const target = protectedLoginPath(pathname);
    const qIndex = target.indexOf("?");
    url.pathname = qIndex === -1 ? target : target.slice(0, qIndex);
    url.search = qIndex === -1 ? "" : target.slice(qIndex);
    return NextResponse.redirect(url);
  }

  if (hasSession) {
    const loginRoute = await fetchBcnLoginRoute(supabase);

    if (pathname === "/switchboard") {
      const url = request.nextUrl.clone();
      url.pathname = loginRoute.route.split("?")[0] ?? loginRoute.route;
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (isAuthRoute) {
      if (hasInviteParam(request)) {
        return supabaseResponse;
      }

      const url = request.nextUrl.clone();
      const next = request.nextUrl.searchParams.get("next");
      const home = authRouteHome(pathname, loginRoute);
      const target =
        next && home !== null ? resolveSafeNext(next, loginRoute) : home;

      if (!target || target === pathname) {
        return supabaseResponse;
      }

      const qIndex = target.indexOf("?");
      url.pathname = qIndex === -1 ? target : target.slice(0, qIndex);
      url.search = qIndex === -1 ? "" : target.slice(qIndex);

      if (url.pathname === pathname && url.search === request.nextUrl.search) {
        return supabaseResponse;
      }

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
