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
  grant_id?: string;
  module_slug?: string;
};

export type TenantPath = {
  domainSlug: string;
  surface: "landing" | "admin" | "wizard";
};

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

export function isDistributorPath(pathname: string): boolean {
  return pathname === "/distributor" || pathname.startsWith("/distributor/");
}

export function isClientPath(pathname: string): boolean {
  return pathname === "/client" || pathname.startsWith("/client/");
}

export function isTenantProtectedSurface(surface: TenantPath["surface"]): boolean {
  return surface === "admin" || surface === "wizard";
}

export function isPlatformProtectedPath(pathname: string): boolean {
  if (isGlobalAdminPath(pathname)) return true;
  if (isDistributorPath(pathname)) return true;
  if (isClientPath(pathname)) return true;
  const tenantPath = parseTenantPath(pathname);
  if (tenantPath && isTenantProtectedSurface(tenantPath.surface)) return true;
  return false;
}

export function parseFfLoginRoute(data: unknown): FfLoginRoute {
  if (!data || typeof data !== "object") {
    return { route: "/login", role: "none" };
  }
  const row = data as Record<string, unknown>;
  const route = typeof row.route === "string" ? row.route : "/login";
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
    grant_id: typeof row.grant_id === "string" ? row.grant_id : undefined,
    module_slug:
      typeof row.module_slug === "string" ? row.module_slug : undefined,
  };
}

export function ffRouteGuardRedirect(
  pathname: string,
  loginRoute: FfLoginRoute
): string | null {
  const role = loginRoute.role ?? "none";

  if (isGlobalAdminPath(pathname)) {
    if (role !== "global_admin") return loginRoute.route;
    return null;
  }

  if (isDistributorPath(pathname)) {
    if (role !== "distributor" && role !== "global_admin") return loginRoute.route;
    return null;
  }

  if (isClientPath(pathname)) {
    if (role !== "client" && role !== "global_admin") return loginRoute.route;
    return null;
  }

  const tenantPath = parseTenantPath(pathname);

  if (tenantPath?.surface === "admin") {
    if (role === "client") {
      return loginRoute.route.startsWith("/client")
        ? loginRoute.route
        : `/client/ff`;
    }
    if (role !== "distributor" && role !== "global_admin") {
      return loginRoute.route;
    }
  }

  if (tenantPath?.surface === "wizard" && role === "distributor") {
    return "/distributor";
  }

  return null;
}
