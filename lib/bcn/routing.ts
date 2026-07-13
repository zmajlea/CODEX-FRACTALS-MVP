import { isReservedRootSegment } from "@/lib/bcn/subdomain";
import { normalizeCommercialRole } from "@/lib/auth/rbac";

export type BcnCommercialRole =
  | "global_admin"
  | "operator"
  | "client"
  | "none";

export type BcnLoginRoute = {
  route: string;
  role?: BcnCommercialRole;
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

export function isOperatorPath(pathname: string): boolean {
  return pathname === "/operator" || pathname.startsWith("/operator/");
}

/** @deprecated use isOperatorPath */
export const isDistributorPath = isOperatorPath;

export function isClientAuthPath(pathname: string): boolean {
  return (
    pathname === "/client/login" ||
    pathname === "/client/signup" ||
    pathname.startsWith("/client/login/") ||
    pathname.startsWith("/client/signup/")
  );
}

export function isClientPath(pathname: string): boolean {
  if (isClientAuthPath(pathname)) return false;
  return pathname === "/client" || pathname.startsWith("/client/");
}

export function isTenantProtectedSurface(surface: TenantPath["surface"]): boolean {
  return surface === "admin" || surface === "wizard";
}

export function isPlatformProtectedPath(pathname: string): boolean {
  if (isGlobalAdminPath(pathname)) return true;
  if (isOperatorPath(pathname)) return true;
  if (isClientPath(pathname)) return true;
  const tenantPath = parseTenantPath(pathname);
  if (tenantPath && isTenantProtectedSurface(tenantPath.surface)) return true;
  return false;
}

export function parseBcnLoginRoute(data: unknown): BcnLoginRoute {
  if (!data || typeof data !== "object") {
    return { route: "/login", role: "none" };
  }
  const row = data as Record<string, unknown>;
  const route = typeof row.route === "string" ? row.route : "/login";
  const role = row.role;
  const normalized = normalizeCommercialRole(
    typeof role === "string" ? role : undefined
  );
  const validRole =
    normalized && normalized !== "none" ? normalized : undefined;

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

export function bcnRouteGuardRedirect(
  pathname: string,
  loginRoute: BcnLoginRoute
): string | null {
  const role = loginRoute.role ?? "none";

  if (isGlobalAdminPath(pathname)) {
    if (role !== "global_admin") return loginRoute.route;
    return null;
  }

  if (isOperatorPath(pathname)) {
    if (role !== "operator" && role !== "global_admin") return loginRoute.route;
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
        : `/client/bcn`;
    }
    if (role !== "operator" && role !== "global_admin") {
      return loginRoute.route;
    }
  }

  if (tenantPath?.surface === "wizard" && role === "operator") {
    return "/operator";
  }

  return null;
}

/** @deprecated use bcnRouteGuardRedirect */
export const ffRouteGuardRedirect = bcnRouteGuardRedirect;
