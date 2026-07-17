import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  afterAuthBootstrap,
  getTier,
  isCodexOneEmail,
  type CommercialTier,
} from "@/lib/auth/rbac";
import {
  CLIENT_LOGIN,
  CLIENT_SIGNUP,
  PORTAL_LOGIN,
} from "@/lib/auth/roles";
import { parseBcnLoginRoute } from "@/lib/bcn/routing";

export type AuthFlow = "portal" | "client";

export { PORTAL_LOGIN, CLIENT_LOGIN, CLIENT_SIGNUP };

const LEGACY_DEFAULTS = new Set(["/switchboard", "/login", ""]);

export function isLegacyDefaultNext(next: string | null | undefined): boolean {
  if (!next) return true;
  const path = next.split("?")[0] ?? "";
  return LEGACY_DEFAULTS.has(path);
}

export type StaffAccess = {
  tier: CommercialTier;
  canEnterPortal: boolean;
};

export async function getStaffAccess(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<StaffAccess> {
  const tier = await getTier(supabase, user.id);
  if (tier === "global_admin" || tier === "operator") {
    return { tier, canEnterPortal: true };
  }
  if (isCodexOneEmail(user.email)) {
    return { tier: "global_admin", canEnterPortal: true };
  }
  return { tier: "none", canEnterPortal: false };
}

async function acceptStaffInviteIfPresent(
  supabase: SupabaseClient<Database>,
  inviteToken: string | null | undefined
) {
  if (!inviteToken) return null;
  const { data, error } = await supabase.rpc("accept_staff_invite", {
    p_token: inviteToken,
  });
  if (error) throw new Error(error.message);
  const route = (data as { route?: string } | null)?.route;
  return typeof route === "string" ? route : null;
}

async function acceptClientInviteIfPresent(
  supabase: SupabaseClient<Database>,
  inviteToken: string | null | undefined
) {
  if (!inviteToken) return null;
  const { data, error } = await supabase.rpc("accept_client_invite", {
    p_token: inviteToken,
  });
  if (error) throw new Error(error.message);
  const route = (data as { route?: string } | null)?.route;
  return typeof route === "string" ? route : null;
}

function portalRouteForTier(tier: CommercialTier): string | null {
  if (tier === "global_admin") return "/admin";
  if (tier === "operator") return "/operator";
  return null;
}

async function clientRouteFromRpc(
  supabase: SupabaseClient<Database>
): Promise<string> {
  const { data, error } = await supabase.rpc("get_client_login_route");
  if (error) return CLIENT_LOGIN;
  const parsed = parseBcnLoginRoute(data);
  if (parsed.role === "client" && parsed.route.startsWith("/client")) {
    return parsed.route;
  }
  return CLIENT_LOGIN;
}

export async function resolvePortalLoginPath(
  supabase: SupabaseClient<Database>,
  user: User,
  options?: { next?: string | null; inviteToken?: string | null }
): Promise<string> {
  await afterAuthBootstrap(supabase, user);

  const inviteRoute = await acceptStaffInviteIfPresent(
    supabase,
    options?.inviteToken
  );
  if (inviteRoute) return inviteRoute;

  const access = await getStaffAccess(supabase, user);
  const roleRoute = portalRouteForTier(access.tier);
  if (access.canEnterPortal && roleRoute) {
    if (options?.next && !isLegacyDefaultNext(options.next)) {
      return options.next;
    }
    return roleRoute;
  }

  throw new Error(
    "No staff access for this account. Ask your CodexOne administrator for a portal invite."
  );
}

export async function resolveClientLoginPath(
  supabase: SupabaseClient<Database>,
  user: User,
  options?: { next?: string | null; inviteToken?: string | null }
): Promise<string> {
  await afterAuthBootstrap(supabase, user);

  const inviteRoute = await acceptClientInviteIfPresent(
    supabase,
    options?.inviteToken
  );
  if (inviteRoute) return inviteRoute;

  const clientRoute = await clientRouteFromRpc(supabase);
  if (clientRoute !== CLIENT_LOGIN) {
    if (options?.next && !isLegacyDefaultNext(options.next)) {
      return options.next;
    }
    return clientRoute;
  }

  const tier = await getTier(supabase, user.id);
  if (tier === "operator") {
    throw new Error(
      "This email is registered as a Operator advisor. Use the staff portal at /portal/login — clients need a separate invite link from your firm."
    );
  }
  if (tier === "global_admin") {
    return "/admin";
  }

  throw new Error(
    "No client modules linked to this account. Use the invite link from your advisor or create an account after they provision a seat."
  );
}

export async function resolvePostAuthPath(
  supabase: SupabaseClient<Database>,
  user: User,
  flow: AuthFlow,
  options?: { next?: string | null; inviteToken?: string | null }
): Promise<string> {
  if (flow === "portal") {
    return resolvePortalLoginPath(supabase, user, options);
  }
  return resolveClientLoginPath(supabase, user, options);
}

export function portalHomeForTier(tier: CommercialTier): string {
  return portalRouteForTier(tier) ?? PORTAL_LOGIN;
}

export function flowLoginPath(flow: AuthFlow): string {
  return flow === "portal" ? PORTAL_LOGIN : CLIENT_LOGIN;
}
