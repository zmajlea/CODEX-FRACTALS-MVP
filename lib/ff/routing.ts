import { isReservedRootSegment } from "@/lib/ff/subdomain";

export type FfCommercialRole =
  | "global_admin"
  | "distributor"
  | "client"
  | "none";

export type FfLoginRoute = {
  route: string;
  role?: FfCommercialRole;
  tenant_id?: string;
  domain_slug?: string;
};

export type TenantPath = {
  domainSlug: string;
  surface: "landing" | "admin" | "wizard";
};

/** Parse path-based tenant routes: /{domain_slug}/admin | /wizard */
export function parseTenantPath(pathname: string): TenantPath | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const head = parts[0]!.toLowerCase();
  if (isReservedRootSegment(head)) return null;

  const domainSlug = parts[0]!;
  if (parts.length === 1) {
    return { domainSlug, surface: "landing" };
  }

  const sub = parts[1]!.toLowerCase();
  if (sub === "admin") return { domainSlug, surface: "admin" };
  if (sub === "wizard") return { domainSlug, surface: "wizard" };

  return null;
}

export function isGlobalAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isTenantProtectedSurface(surface: TenantPath["surface"]): boolean {
  return surface === "admin" || surface === "wizard";
}

export function parseFfLoginRoute(data: unknown): FfLoginRoute {
  if (!data || typeof data !== "object") {
    return { route: "/switchboard", role: "none" };
  }
  const row = data as Record<string, unknown>;
  const route = typeof row.route === "string" ? row.route : "/switchboard";
  const role = row.role;
  const validRole =
    role === "global_admin" ||
    role === "distributor" ||
    role === "client" ||
    role === "none"
      ? role
      : undefined;

  return {
    route,
    role: validRole,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : undefined,
    domain_slug:
      typeof row.domain_slug === "string" ? row.domain_slug : undefined,
  };
}

/**
 * Returns a redirect pathname when the session role may not access the URL.
 * Returns null when the request should proceed.
 */
export function ffRouteGuardRedirect(
  pathname: string,
  loginRoute: FfLoginRoute
): string | null {
  const role = loginRoute.role ?? "none";
  const tenantPath = parseTenantPath(pathname);

  if (isGlobalAdminPath(pathname)) {
    if (role !== "global_admin") {
      return loginRoute.route;
    }
    return null;
  }

  if (tenantPath?.surface === "admin") {
    if (role === "client") {
      return `/${tenantPath.domainSlug}/wizard`;
    }
    if (role !== "distributor" && role !== "global_admin") {
      return loginRoute.route;
    }
  }

  return null;
}
